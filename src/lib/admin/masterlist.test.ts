import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db";
import {
    buildMasterlistPreview,
    buildMasterlistReportCsv,
    MasterlistParseError,
    MAX_MASTERLIST_BYTES,
    MAX_MASTERLIST_ROWS,
    parseMasterlistBuffer,
} from "./masterlist";

async function buildXlsxBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");
    for (const row of rows) {
        sheet.addRow(row);
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}

describe("masterlist parser, limits, and CSV report hardening", () => {
    it("parses CSV with full_name splitting ('Last, First Middle' and 'First Last')", async () => {
        const csv = [
            "Student ID,Full Name",
            '2024-01001,"De La Cruz, Clara Maria"',
            "2024-01002,Marco Antonio Santos",
        ].join("\n");

        const rows = await parseMasterlistBuffer(Buffer.from(csv, "utf8"), "roster.csv");
        expect(rows).toEqual([
            {
                rowNumber: 2,
                studentIdNumber: "2024-01001",
                firstName: "Clara",
                middleName: "Maria",
                lastName: "De La Cruz",
                fullName: "De La Cruz, Clara Maria",
            },
            {
                rowNumber: 3,
                studentIdNumber: "2024-01002",
                firstName: "Marco",
                middleName: "Antonio",
                lastName: "Santos",
                fullName: "Marco Antonio Santos",
            },
        ]);
    });

    it("parses streaming XLSX and aborts immediately when exceeding 2,000 rows or 5 MB", async () => {
        const xlsx = await buildXlsxBuffer([
            ["student_id_number", "first_name", "last_name"],
            ["2024-02001", "Elena", "Reyes"],
        ]);
        const parsed = await parseMasterlistBuffer(xlsx, "students.xlsx");
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
            studentIdNumber: "2024-02001",
            firstName: "Elena",
            lastName: "Reyes",
            fullName: "Elena Reyes",
        });

        const oversizedLines = ["student_id_number,full_name"];
        for (let i = 0; i <= MAX_MASTERLIST_ROWS; i++) {
            oversizedLines.push(`2025-${String(i).padStart(5, "0")},Student ${i}`);
        }
        await expect(
            parseMasterlistBuffer(Buffer.from(oversizedLines.join("\n"), "utf8"), "huge.csv"),
        ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });

        const oversizedXlsxRows: Array<Array<string>> = [
            ["student_id_number", "first_name", "last_name"],
        ];
        for (let i = 0; i <= MAX_MASTERLIST_ROWS; i++) {
            oversizedXlsxRows.push([`2026-${String(i).padStart(5, "0")}`, "First", `Last${i}`]);
        }
        const oversizedXlsx = await buildXlsxBuffer(oversizedXlsxRows);
        await expect(parseMasterlistBuffer(oversizedXlsx, "huge.xlsx")).rejects.toMatchObject({
            code: "TOO_MANY_ROWS",
        });

        const tooLargeBuffer = Buffer.alloc(MAX_MASTERLIST_BYTES + 1, 0x41);
        await expect(parseMasterlistBuffer(tooLargeBuffer, "big.csv")).rejects.toBeInstanceOf(
            MasterlistParseError,
        );
    });

    it("flags duplicates, formula prefixes, malformed names, and existing non-ACTIVE accounts", async () => {
        const fakeDb = {
            select: () => ({
                from: async () => [
                    {
                        id: "u-active",
                        studentIdNumber: "2024-00001",
                        fullName: "Existing Active",
                        systemRole: "MEMBER",
                        accountStatus: "ACTIVE",
                    },
                    {
                        id: "u-disabled",
                        studentIdNumber: "2024-00002",
                        fullName: "Former Student",
                        systemRole: "MEMBER",
                        accountStatus: "DISABLED",
                    },
                    {
                        id: "u-missing",
                        studentIdNumber: "2024-00099",
                        fullName: "Missing Active",
                        systemRole: "MEMBER",
                        accountStatus: "ACTIVE",
                    },
                ],
            }),
        } as unknown as DbExecutor;

        const csv = [
            "student_id_number,first_name,last_name",
            "2024-00001,Existing,Active",
            "2024-00002,Former,Student",
            "2024-00003,New,Student",
            "2024-00003,Dup,Student",
            "=CMD(),Evil,Formula",
        ].join("\n");

        const raw = await parseMasterlistBuffer(Buffer.from(csv, "utf8"), "test.csv");
        const preview = await buildMasterlistPreview(fakeDb, raw, "test.csv");

        expect(preview.hasBlockingErrors).toBe(true);
        expect(preview.toCreate.map((r) => r.studentIdNumber)).toEqual(["2024-00003"]);
        expect(preview.existingActive.map((r) => r.studentIdNumber)).toEqual(["2024-00001"]);
        expect(preview.missingFromMasterlist.map((m) => m.studentIdNumber)).toEqual(["2024-00099"]);

        expect(preview.warnings.map((w) => w.code)).toEqual([
            "EXISTING_NON_ACTIVE",
            "DUPLICATE_IN_FILE",
            "FORMULA_PREFIX_REJECTED",
        ]);
    });

    it("neutralizes formula prefixes in exported discrepancy report CSV", () => {
        const csv = buildMasterlistReportCsv({
            warnings: [
                {
                    rowNumber: 2,
                    studentIdNumber: "=SUM(1,1)",
                    fullName: "+HYPERLINK()",
                    code: "FORMULA_PREFIX_REJECTED",
                    blocking: true,
                    message: "@blocked",
                },
            ],
        });

        expect(csv).toContain("'=SUM(1,1)");
        expect(csv).toContain("'+HYPERLINK()");
        expect(csv).toContain("'@blocked");
    });
});
