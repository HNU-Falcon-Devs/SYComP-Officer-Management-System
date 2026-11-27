import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { AccountStatus, SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { formatCsvRow } from "@/lib/security/csv-safe";

export const MAX_MASTERLIST_BYTES = 5 * 1024 * 1024;
export const MAX_MASTERLIST_ROWS = 2_000;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const STUDENT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export class MasterlistParseError extends Error {
    readonly status: 400;
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "MasterlistParseError";
        this.status = 400;
        this.code = code;
    }
}

export interface RawMasterlistRow {
    rowNumber: number;
    studentIdNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    fullName: string;
}

export interface MasterlistWarningItem {
    rowNumber: number | null;
    studentIdNumber: string;
    fullName: string;
    code:
        | "FORMULA_PREFIX_REJECTED"
        | "INVALID_STUDENT_ID"
        | "MALFORMED_ROW"
        | "DUPLICATE_IN_FILE"
        | "EXISTING_NON_ACTIVE";
    blocking: boolean;
    message: string;
    accountStatus?: AccountStatus;
}

export interface MasterlistPreviewResult {
    sourceFilename: string;
    totalRows: number;
    hasBlockingErrors: boolean;
    toCreate: RawMasterlistRow[];
    existingActive: Array<{
        rowNumber: number;
        userId: string;
        studentIdNumber: string;
        fullName: string;
        systemRole: SystemRole;
    }>;
    warnings: MasterlistWarningItem[];
    missingFromMasterlist: Array<{
        userId: string;
        studentIdNumber: string;
        fullName: string;
    }>;
}

function normalizeHeaderKey(header: string): string {
    return header
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function extractExcelCellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        if ("text" in value && typeof value.text === "string") {
            return value.text;
        }
        if ("result" in value && value.result !== undefined && value.result !== null) {
            return String(value.result);
        }
        if ("richText" in value && Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text).join("");
        }
        if ("formula" in value && typeof value.formula === "string") {
            return `=${value.formula}`;
        }
    }
    return "";
}

function mapRecordToRawRow(
    rowNumber: number,
    record: Record<string, string>,
): RawMasterlistRow {
    const mapped = new Map<string, string>();
    for (const [rawKey, rawVal] of Object.entries(record)) {
        const key = normalizeHeaderKey(rawKey);
        if (key) {
            mapped.set(key, rawVal ?? "");
        }
    }

    const studentIdNumber = (
        mapped.get("student_id_number") ??
        mapped.get("student_id") ??
        mapped.get("id_number") ??
        mapped.get("id") ??
        ""
    ).trim();

    let firstName = (mapped.get("first_name") ?? mapped.get("given_name") ?? "").trim();
    let middleName = (
        mapped.get("middle_name") ??
        mapped.get("middle_initial") ??
        ""
    ).trim() || null;
    let lastName = (
        mapped.get("last_name") ??
        mapped.get("surname") ??
        mapped.get("family_name") ??
        ""
    ).trim();
    let fullName = (
        mapped.get("full_name") ??
        mapped.get("student_name") ??
        mapped.get("name") ??
        ""
    ).trim();

    if ((!firstName || !lastName) && fullName) {
        if (fullName.includes(",")) {
            const [left, right] = fullName.split(",", 2);
            lastName = lastName || (left ?? "").trim();
            const restTokens = (right ?? "").trim().split(/\s+/).filter(Boolean);
            firstName = firstName || (restTokens[0] ?? "");
            if (!middleName && restTokens.length > 1) {
                middleName = restTokens.slice(1).join(" ");
            }
        } else {
            const tokens = fullName.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                firstName = firstName || tokens[0]!;
                lastName = lastName || tokens[tokens.length - 1]!;
                if (!middleName && tokens.length > 2) {
                    middleName = tokens.slice(1, -1).join(" ");
                }
            }
        }
    }

    if (!fullName && firstName && lastName) {
        fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
    }

    return {
        rowNumber,
        studentIdNumber,
        firstName,
        middleName,
        lastName,
        fullName,
    };
}

function assertHeaderPresence(headers: string[]) {
    const normalized = new Set(headers.map(normalizeHeaderKey));
    const hasId =
        normalized.has("student_id_number") ||
        normalized.has("student_id") ||
        normalized.has("id_number") ||
        normalized.has("id");
    const hasName =
        normalized.has("full_name") ||
        normalized.has("student_name") ||
        normalized.has("name") ||
        (normalized.has("first_name") && normalized.has("last_name")) ||
        (normalized.has("given_name") && normalized.has("surname"));

    if (!hasId || !hasName) {
        throw new MasterlistParseError(
            "MISSING_REQUIRED_COLUMNS",
            "Upload must include a Student ID column and either Full Name or First/Last Name columns.",
        );
    }
}

export async function parseMasterlistBuffer(
    buffer: Buffer,
    filename: string,
): Promise<RawMasterlistRow[]> {
    if (buffer.byteLength === 0) {
        throw new MasterlistParseError("EMPTY_FILE", "Uploaded file is empty.");
    }
    if (buffer.byteLength > MAX_MASTERLIST_BYTES) {
        throw new MasterlistParseError(
            "FILE_TOO_LARGE",
            "Masterlist file exceeds the 5 MB limit.",
        );
    }

    const lower = filename.trim().toLowerCase();
    if (lower.endsWith(".csv")) {
        const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
        const parsed = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: "greedy",
        });

        const fields = parsed.meta.fields ?? [];
        if (fields.length === 0) {
            throw new MasterlistParseError("EMPTY_FILE", "CSV header row is missing.");
        }
        assertHeaderPresence(fields);

        if (parsed.data.length === 0) {
            throw new MasterlistParseError("EMPTY_FILE", "No student rows found in CSV file.");
        }

        if (parsed.data.length > MAX_MASTERLIST_ROWS) {
            throw new MasterlistParseError(
                "TOO_MANY_ROWS",
                `Masterlist exceeds the ${MAX_MASTERLIST_ROWS}-row batch limit.`,
            );
        }

        return parsed.data.map((record, index) => mapRecordToRawRow(index + 2, record));
    }

    if (lower.endsWith(".xlsx")) {
        type WorkbookReaderInternal = Omit<ExcelJS.stream.xlsx.WorkbookReader, "model"> & {
            model?: { sheets?: unknown[] };
            sharedStrings?: unknown[];
            workbookRels?: unknown[];
        };

        // Pass 1: stream xl/sharedStrings.xml only (avoids ExcelJS temp-file buffering when sheet1.xml precedes sharedStrings.xml)
        const ssReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
            worksheets: "ignore",
            sharedStrings: "cache",
        }) as unknown as WorkbookReaderInternal;
        ssReader.model = { sheets: [] };
        ssReader.sharedStrings = [];
        ssReader.workbookRels = [];
        for await (const _sheet of ssReader) {
            void _sheet;
        }

        // Pass 2: stream first worksheet row-by-row and abort immediately past MAX_MASTERLIST_ROWS
        const rows: RawMasterlistRow[] = [];
        let headers: string[] = [];
        let worksheetProcessed = false;

        const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
            worksheets: "emit",
            sharedStrings: "ignore",
        }) as unknown as WorkbookReaderInternal;
        workbookReader.model = { sheets: [] };
        workbookReader.sharedStrings = ssReader.sharedStrings ?? [];
        workbookReader.workbookRels = [];

        for await (const worksheetReader of workbookReader) {
            if (worksheetProcessed) {
                break;
            }
            worksheetProcessed = true;

            for await (const row of worksheetReader) {
                const rawValues = Array.isArray(row.values) ? row.values : [];
                const cellTexts = rawValues.slice(1).map((v) => extractExcelCellText(v));
                const isBlankRow = cellTexts.every((cell) => cell.trim() === "");
                if (isBlankRow) {
                    continue;
                }

                if (headers.length === 0) {
                    headers = cellTexts;
                    assertHeaderPresence(headers);
                    continue;
                }

                if (rows.length >= MAX_MASTERLIST_ROWS) {
                    throw new MasterlistParseError(
                        "TOO_MANY_ROWS",
                        `Masterlist exceeds the ${MAX_MASTERLIST_ROWS}-row batch limit.`,
                    );
                }

                const record: Record<string, string> = {};
                for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                    const headerName = headers[colIdx];
                    if (headerName) {
                        record[headerName] = cellTexts[colIdx] ?? "";
                    }
                }
                rows.push(mapRecordToRawRow(row.number, record));
            }
        }

        if (headers.length === 0) {
            throw new MasterlistParseError("EMPTY_FILE", "XLSX worksheet has no header row.");
        }
        if (rows.length === 0) {
            throw new MasterlistParseError("EMPTY_FILE", "No student rows found in XLSX worksheet.");
        }

        return rows;
    }

    throw new MasterlistParseError(
        "UNSUPPORTED_FORMAT",
        "Only .csv and .xlsx files are supported.",
    );
}

export async function buildMasterlistPreview(
    executor: DbExecutor,
    rawRows: RawMasterlistRow[],
    sourceFilename: string,
): Promise<MasterlistPreviewResult> {
    if (rawRows.length > MAX_MASTERLIST_ROWS) {
        throw new MasterlistParseError(
            "TOO_MANY_ROWS",
            `Masterlist exceeds the ${MAX_MASTERLIST_ROWS}-row batch limit.`,
        );
    }

    const existingUsers = await executor
        .select({
            id: users.id,
            studentIdNumber: users.studentIdNumber,
            fullName: users.fullName,
            systemRole: users.systemRole,
            accountStatus: users.accountStatus,
        })
        .from(users);

    const userByNormalizedId = new Map(
        existingUsers.map((u) => [u.studentIdNumber.trim().toUpperCase(), u]),
    );

    const seenInFile = new Set<string>();
    const uploadedIds = new Set<string>();
    const toCreate: RawMasterlistRow[] = [];
    const existingActive: MasterlistPreviewResult["existingActive"] = [];
    const warnings: MasterlistWarningItem[] = [];

    for (const row of rawRows) {
        const rawId = row.studentIdNumber.trim();
        const normalizedId = rawId.toUpperCase();
        const fieldsToCheck = [
            rawId,
            row.firstName,
            row.middleName ?? "",
            row.lastName,
            row.fullName,
        ];

        if (fieldsToCheck.some((val) => FORMULA_PREFIX.test(val))) {
            warnings.push({
                rowNumber: row.rowNumber,
                studentIdNumber: rawId || "(blank)",
                fullName: row.fullName || "(blank)",
                code: "FORMULA_PREFIX_REJECTED",
                blocking: true,
                message: "Cell starts with a disallowed spreadsheet formula character (=, +, -, @).",
            });
            continue;
        }

        if (!rawId || rawId.length > 32 || !STUDENT_ID_PATTERN.test(rawId)) {
            warnings.push({
                rowNumber: row.rowNumber,
                studentIdNumber: rawId || "(blank)",
                fullName: row.fullName || "(blank)",
                code: "INVALID_STUDENT_ID",
                blocking: true,
                message: "Student ID must be 1–32 alphanumeric/hyphen characters.",
            });
            continue;
        }

        if (!row.firstName.trim() || !row.lastName.trim() || !row.fullName.trim()) {
            warnings.push({
                rowNumber: row.rowNumber,
                studentIdNumber: normalizedId,
                fullName: row.fullName || "(missing name)",
                code: "MALFORMED_ROW",
                blocking: true,
                message: "Row must provide both first name and last name.",
            });
            continue;
        }

        if (seenInFile.has(normalizedId)) {
            warnings.push({
                rowNumber: row.rowNumber,
                studentIdNumber: normalizedId,
                fullName: row.fullName,
                code: "DUPLICATE_IN_FILE",
                blocking: true,
                message: "Duplicate Student ID within the uploaded file.",
            });
            continue;
        }

        seenInFile.add(normalizedId);
        uploadedIds.add(normalizedId);

        const existing = userByNormalizedId.get(normalizedId);
        if (!existing) {
            toCreate.push({
                ...row,
                studentIdNumber: normalizedId,
            });
            continue;
        }

        if (existing.accountStatus !== "ACTIVE") {
            warnings.push({
                rowNumber: row.rowNumber,
                studentIdNumber: existing.studentIdNumber,
                fullName: existing.fullName,
                code: "EXISTING_NON_ACTIVE",
                blocking: false,
                accountStatus: existing.accountStatus,
                message: `Existing account is ${existing.accountStatus}; skipped from auto-creation and requires manual review.`,
            });
            continue;
        }

        existingActive.push({
            rowNumber: row.rowNumber,
            userId: existing.id,
            studentIdNumber: existing.studentIdNumber,
            fullName: existing.fullName,
            systemRole: existing.systemRole,
        });
    }

    const missingFromMasterlist = existingUsers
        .filter(
            (u) =>
                u.accountStatus === "ACTIVE" &&
                u.systemRole === "MEMBER" &&
                !uploadedIds.has(u.studentIdNumber.trim().toUpperCase()),
        )
        .map((u) => ({
            userId: u.id,
            studentIdNumber: u.studentIdNumber,
            fullName: u.fullName,
        }));

    return {
        sourceFilename,
        totalRows: rawRows.length,
        hasBlockingErrors: warnings.some((w) => w.blocking),
        toCreate,
        existingActive,
        warnings,
        missingFromMasterlist,
    };
}

export async function hashRowsWithBoundedConcurrency(
    rows: readonly RawMasterlistRow[],
    concurrency = 8,
): Promise<Array<RawMasterlistRow & { passwordHash: string }>> {
    if (rows.length === 0) {
        return [];
    }

    const results = new Array<RawMasterlistRow & { passwordHash: string }>(rows.length);
    let cursor = 0;

    async function worker() {
        while (cursor < rows.length) {
            const index = cursor++;
            const row = rows[index]!;
            const defaultPassword = normalizeDefaultPassword(row.lastName, row.studentIdNumber);
            const passwordHash = await hashPassword(defaultPassword);
            results[index] = { ...row, passwordHash };
        }
    }

    const workerCount = Math.min(concurrency, rows.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

export interface MasterlistReportSummary {
    warnings?: MasterlistWarningItem[];
    flaggedMissing?: Array<{
        userId: string;
        studentIdNumber: string;
        fullName: string;
    }>;
}

export function buildMasterlistReportCsv(summary: MasterlistReportSummary | null): string {
    const lines: string[] = [
        formatCsvRow(["Category", "Row", "Student ID", "Full Name", "Code", "Detail"]),
    ];

    for (const warn of summary?.warnings ?? []) {
        lines.push(
            formatCsvRow([
                warn.blocking ? "BLOCKING_WARNING" : "ACCOUNT_WARNING",
                warn.rowNumber ?? "",
                warn.studentIdNumber,
                warn.fullName,
                warn.code,
                warn.message,
            ]),
        );
    }

    for (const missing of summary?.flaggedMissing ?? []) {
        lines.push(
            formatCsvRow([
                "MISSING_FROM_MASTERLIST",
                "",
                missing.studentIdNumber,
                missing.fullName,
                "NEEDS_REVIEW",
                "Previously active member absent from uploaded masterlist.",
            ]),
        );
    }

    return `${lines.join("\r\n")}\r\n`;
}
