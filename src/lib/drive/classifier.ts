export const ALLOWED_UPLOAD_EXTENSION_MIMES: Record<string, readonly string[]> = {
    ".pdf": ["application/pdf"],
    ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ".png": ["image/png"],
    ".jpg": ["image/jpeg"],
    ".jpeg": ["image/jpeg"],
    ".txt": ["text/plain"],
    ".csv": ["text/csv", "application/vnd.ms-excel", "text/plain"],
};

export const ACCEPTED_FILE_EXTENSIONS = Object.keys(ALLOWED_UPLOAD_EXTENSION_MIMES);
export const ACCEPT_INPUT_ATTR = ACCEPTED_FILE_EXTENSIONS.join(",");

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;
const FORBIDDEN_DRIVE_CHARS_RE = /[\\/:*?"<>|]/g;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Sanitizes a single Google Drive folder segment, blocking path traversal and control bytes. */
export function sanitizeDriveSegment(raw: string, fallback = "Untitled"): string {
    const cleaned = raw
        .replace(CONTROL_CHARS_RE, "")
        .replace(/\.\./g, "-")
        .replace(FORBIDDEN_DRIVE_CHARS_RE, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+|\.+$/g, "")
        .trim()
        .slice(0, 100)
        .replace(/^\.+|\.+$/g, "")
        .trim();

    return cleaned.length > 0 && !/^-+$/.test(cleaned) ? cleaned : fallback;
}

/** Strips directory paths and unsafe characters from an uploaded filename. */
export function sanitizeUploadFilename(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? "";
    const cleaned = base
        .replace(CONTROL_CHARS_RE, "")
        .replace(/\.\.+/g, ".")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim()
        .replace(/^\.+/, "");

    if (!cleaned) {
        return "document";
    }
    if (cleaned.length <= 200) {
        return cleaned;
    }

    const ext = extractFileExtension(cleaned);
    if (!ext) {
        return cleaned.slice(0, 200);
    }
    const stemMax = Math.max(1, 200 - ext.length);
    return `${cleaned.slice(0, stemMax)}${ext}`;
}

export function extractFileExtension(filename: string): string | null {
    const base = filename.split(/[\\/]/).pop()?.trim() ?? "";
    const lastDot = base.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === base.length - 1) {
        return null;
    }
    return base.slice(lastDot).toLowerCase();
}

export type FileDescriptorValidationResult =
    | {
          ok: true;
          sanitizedFilename: string;
          extension: string;
          canonicalMimeType: string;
      }
    | {
          ok: false;
          code: "INVALID_FILE_TYPE" | "FILE_TOO_LARGE" | "EMPTY_FILE";
          status: 400 | 413;
          message: string;
      };

export function validateUploadFileDescriptor(input: {
    filename: string;
    mimeType: string;
    fileSizeBytes: number;
    maxUploadSizeBytes: number;
}): FileDescriptorValidationResult {
    if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
        return {
            ok: false,
            code: "EMPTY_FILE",
            status: 400,
            message: "Uploaded file must be greater than 0 bytes.",
        };
    }

    if (input.fileSizeBytes > input.maxUploadSizeBytes) {
        const limitMb = Math.round((input.maxUploadSizeBytes / (1024 * 1024)) * 10) / 10;
        return {
            ok: false,
            code: "FILE_TOO_LARGE",
            status: 413,
            message: `File exceeds the maximum allowed size of ${limitMb} MB.`,
        };
    }

    const sanitizedFilename = sanitizeUploadFilename(input.filename);
    const extension = extractFileExtension(sanitizedFilename);
    if (!extension || !Object.hasOwn(ALLOWED_UPLOAD_EXTENSION_MIMES, extension)) {
        return {
            ok: false,
            code: "INVALID_FILE_TYPE",
            status: 400,
            message: `Unsupported file extension. Allowed formats: ${ACCEPTED_FILE_EXTENSIONS.join(", ")}.`,
        };
    }

    const normalizedMime = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    const allowedMimes = ALLOWED_UPLOAD_EXTENSION_MIMES[extension];
    if (!allowedMimes.includes(normalizedMime)) {
        return {
            ok: false,
            code: "INVALID_FILE_TYPE",
            status: 400,
            message: `MIME type "${normalizedMime || "unknown"}" is not permitted for ${extension} files.`,
        };
    }

    return {
        ok: true,
        sanitizedFilename,
        extension,
        canonicalMimeType: allowedMimes[0],
    };
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
    if (bytes.length < prefix.length) {
        return false;
    }
    for (let i = 0; i < prefix.length; i += 1) {
        if (bytes[i] !== prefix[i]) {
            return false;
        }
    }
    return true;
}

const DISALLOWED_TEXT_PREFIX_RE = /^(?:<!doctype\s+html|<html\b|<script\b|<svg\b)/i;

/** Validates leading magic bytes against the expected file extension. */
export function verifyFileMagicBytes(extension: string, headerBytes: Uint8Array): boolean {
    if (headerBytes.length === 0) {
        return false;
    }

    const ext = extension.toLowerCase();
    if (ext === ".pdf") {
        return startsWithBytes(headerBytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    }
    if (ext === ".png") {
        return startsWithBytes(headerBytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (ext === ".jpg" || ext === ".jpeg") {
        return startsWithBytes(headerBytes, [0xff, 0xd8, 0xff]);
    }
    if (ext === ".docx" || ext === ".xlsx" || ext === ".pptx") {
        return (
            startsWithBytes(headerBytes, [0x50, 0x4b, 0x03, 0x04]) ||
            startsWithBytes(headerBytes, [0x50, 0x4b, 0x05, 0x06])
        );
    }
    if (ext === ".txt" || ext === ".csv") {
        for (const byte of headerBytes) {
            if (byte === 0x00) {
                return false;
            }
        }
        if (
            startsWithBytes(headerBytes, [0x4d, 0x5a]) || // MZ (PE/EXE)
            startsWithBytes(headerBytes, [0x7f, 0x45, 0x4c, 0x46]) || // \x7fELF
            startsWithBytes(headerBytes, [0x23, 0x21]) || // #! shell script
            startsWithBytes(headerBytes, [0xca, 0xfe, 0xba, 0xbe]) // Mach-O
        ) {
            return false;
        }
        const previewText = new TextDecoder("utf-8", { fatal: false })
            .decode(headerBytes)
            .replace(/^\uFEFF/, "")
            .trimStart();
        if (DISALLOWED_TEXT_PREFIX_RE.test(previewText)) {
            return false;
        }
        return true;
    }

    return false;
}

export interface ResolveDriveFolderPathInput {
    academicTermName: string;
    academicTermCode: string;
    documentTypeSegment: string;
    documentTypeSlug: string;
    eventTitle?: string | null;
    eventSlug?: string | null;
    isProposal?: boolean;
}

export interface ResolvedDrivePath {
    segments: [string, string, string];
    pathKey: string;
    segmentPathKeys: [string, string, string];
    displayPath: string;
}

function normalizePathKeySegment(raw: string): string {
    return raw
        .replace(CONTROL_CHARS_RE, "")
        .replace(/\.\./g, "-")
        .replace(/[\\/]/g, "-")
        .trim()
        .toLowerCase()
        .slice(0, 120);
}

/**
 * Isolated Drive folder routing strategy (BR-DOC-02 / docs/06 Sec 8.1):
 * - Proposal attachment -> [AcademicTerm] / "Proposals" / [EventTitle]
 * - Event-linked doc    -> [AcademicTerm] / [DocumentType] / [EventTitle]
 * - Unlinked doc        -> [AcademicTerm] / [DocumentType] / "General"
 */
export function resolveDriveFolderPath(input: ResolveDriveFolderPathInput): ResolvedDrivePath {
    const termSeg = sanitizeDriveSegment(input.academicTermName, input.academicTermCode);
    const termKey = normalizePathKeySegment(input.academicTermCode);

    if (input.isProposal && input.eventTitle) {
        const eventSeg = sanitizeDriveSegment(input.eventTitle, "Event");
        const eventKey = normalizePathKeySegment(input.eventSlug ?? eventSeg);
        const typeKey = `${termKey}/proposals`;
        const leafKey = `${typeKey}/${eventKey}`;
        return {
            segments: [termSeg, "Proposals", eventSeg],
            pathKey: leafKey,
            segmentPathKeys: [termKey, typeKey, leafKey],
            displayPath: `${termSeg} / Proposals / ${eventSeg}`,
        };
    }

    const typeSeg = sanitizeDriveSegment(input.documentTypeSegment, "Documents");
    const typeSlugKey = normalizePathKeySegment(input.documentTypeSlug);
    const typeKey = `${termKey}/${typeSlugKey}`;

    const leafSeg = input.eventTitle ? sanitizeDriveSegment(input.eventTitle, "Event") : "General";
    const leafSlugKey = input.eventTitle
        ? normalizePathKeySegment(input.eventSlug ?? leafSeg)
        : "general";
    const leafKey = `${typeKey}/${leafSlugKey}`;

    return {
        segments: [termSeg, typeSeg, leafSeg],
        pathKey: leafKey,
        segmentPathKeys: [termKey, typeKey, leafKey],
        displayPath: `${termSeg} / ${typeSeg} / ${leafSeg}`,
    };
}

const ALLOWED_EXTERNAL_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

export function validateExternalDriveUrl(
    rawUrl: string,
): { ok: true; normalizedUrl: string } | { ok: false; message: string } {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return { ok: false, message: "Google Drive URL is required." };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, message: "Provide a valid https://drive.google.com or https://docs.google.com URL." };
    }

    if (parsed.protocol !== "https:") {
        return { ok: false, message: "External Drive links must use https://." };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, message: "External Drive links cannot include embedded credentials." };
    }
    if (!ALLOWED_EXTERNAL_DRIVE_HOSTS.has(parsed.hostname.toLowerCase())) {
        return {
            ok: false,
            message: "External links must point strictly to drive.google.com or docs.google.com.",
        };
    }

    return { ok: true, normalizedUrl: parsed.toString() };
}

export function buildSafeDrivePreviewUrl(input: {
    driveFileId: string | null;
    webViewLink: string;
    storageMode: "DRIVE_UPLOAD" | "EXTERNAL_LINK";
}): string | null {
    if (
        input.driveFileId &&
        !input.driveFileId.startsWith("mock-file-") &&
        DRIVE_ID_RE.test(input.driveFileId)
    ) {
        return `https://drive.google.com/file/d/${input.driveFileId}/preview`;
    }

    if (input.storageMode === "EXTERNAL_LINK") {
        const validated = validateExternalDriveUrl(input.webViewLink);
        if (!validated.ok) {
            return null;
        }
        const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{8,128})(?:\/|\?|$)/.exec(
            validated.normalizedUrl,
        );
        if (match?.[1] && !match[1].startsWith("mock-file-")) {
            return `https://drive.google.com/file/d/${match[1]}/preview`;
        }
    }

    return null;
}
