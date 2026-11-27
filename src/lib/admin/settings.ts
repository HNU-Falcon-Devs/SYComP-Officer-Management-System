import { z } from "zod";

const DRIVE_SEGMENT_FORBIDDEN = /[\\/:*?"<>|\x00-\x1f\x7f]/;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyDocumentTypeName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100)
        .replace(/-+$/g, "");
}

export function isValidDriveFolderSegment(segment: string): boolean {
    const trimmed = segment.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
        return false;
    }
    if (trimmed === "." || trimmed === "..") {
        return false;
    }
    if (trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.includes("..")) {
        return false;
    }
    return !DRIVE_SEGMENT_FORBIDDEN.test(trimmed);
}

export const documentTypeSlugSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug must be at least 2 characters.")
    .max(100, "Slug must be at most 100 characters.")
    .regex(SLUG_REGEX, "Slug must use lowercase letters, numbers, and single hyphens.");

export const driveFolderSegmentSchema = z
    .string()
    .trim()
    .min(2, "Folder segment must be at least 2 characters.")
    .max(120, "Folder segment must be at most 120 characters.")
    .refine(
        isValidDriveFolderSegment,
        "Folder segment cannot contain path separators, |, control characters, '..', or leading/trailing dots.",
    );

export const createDocumentTypeSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Document type name must be at least 2 characters.")
        .max(100, "Document type name must be at most 100 characters."),
    slug: z.preprocess(
        (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
        documentTypeSlugSchema.optional(),
    ),
    driveFolderSegment: driveFolderSegmentSchema,
});

export const updateDocumentTypeSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Document type name must be at least 2 characters.")
            .max(100, "Document type name must be at most 100 characters.")
            .optional(),
        driveFolderSegment: driveFolderSegmentSchema.optional(),
        isActive: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (data) =>
            data.name !== undefined ||
            data.driveFolderSegment !== undefined ||
            data.isActive !== undefined,
        {
            message: "Provide at least one field to update.",
        },
    );

export function isPgUniqueViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const record = error as { code?: unknown; cause?: { code?: unknown } };
    return record.code === "23505" || record.cause?.code === "23505";
}

export interface DocumentTypeDto {
    id: string;
    name: string;
    slug: string;
    driveFolderSegment: string;
    isActive: boolean;
    documentCount: number;
    createdBy: {
        id: string;
        studentIdNumber: string;
        fullName: string;
    } | null;
    createdAt: string;
    updatedAt: string;
}

export interface SystemSettingsSummary {
    runtime: {
        appUrl: string;
        universityEmailDomain: string | null;
        emailProvider: "console" | "resend" | "smtp";
        emailFrom: string;
        driveShareMode: "domain" | "unlisted";
        maxUploadSizeBytes: number;
    };
    integrations: {
        databaseConnected: boolean;
        driveConfigured: boolean;
        emailTransportConfigured: boolean;
        otpSecretConfigured: boolean;
        uploadIntentSecretConfigured: boolean;
    };
}

function nonEmpty(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function buildSystemSettingsSummary(
    source: Record<string, string | undefined> = process.env,
): SystemSettingsSummary {
    const rawProvider = source.EMAIL_PROVIDER?.trim().toLowerCase();
    const emailProvider: "console" | "resend" | "smtp" =
        rawProvider === "resend" || rawProvider === "smtp" ? rawProvider : "console";

    const rawShareMode = source.DRIVE_SHARE_MODE?.trim().toLowerCase();
    const driveShareMode: "domain" | "unlisted" =
        rawShareMode === "unlisted" ? "unlisted" : "domain";

    const parsedBytes = Number(source.MAX_UPLOAD_SIZE_BYTES);
    const maxUploadSizeBytes =
        Number.isFinite(parsedBytes) && parsedBytes > 0 ? Math.trunc(parsedBytes) : 15_728_640;

    const driveConfigured = Boolean(
        nonEmpty(source.GOOGLE_DRIVE_CLIENT_ID) &&
            nonEmpty(source.GOOGLE_DRIVE_CLIENT_SECRET) &&
            nonEmpty(source.GOOGLE_DRIVE_REFRESH_TOKEN) &&
            nonEmpty(source.GOOGLE_DRIVE_ROOT_FOLDER_ID),
    );

    const emailTransportConfigured =
        emailProvider === "console"
            ? true
            : emailProvider === "resend"
              ? Boolean(nonEmpty(source.RESEND_API_KEY))
              : Boolean(
                    nonEmpty(source.SMTP_HOST) &&
                        nonEmpty(source.SMTP_PORT) &&
                        nonEmpty(source.SMTP_USER) &&
                        nonEmpty(source.SMTP_PASS),
                );

    const otpSecret = nonEmpty(source.OTP_HMAC_SECRET);
    const uploadSecret = nonEmpty(source.UPLOAD_INTENT_SECRET);

    return {
        runtime: {
            appUrl: nonEmpty(source.APP_URL) ?? "http://localhost:3000",
            universityEmailDomain: nonEmpty(source.UNIVERSITY_EMAIL_DOMAIN)?.toLowerCase() ?? null,
            emailProvider,
            emailFrom: nonEmpty(source.EMAIL_FROM) ?? "SYComP OMS <no-reply@sycomp.local>",
            driveShareMode,
            maxUploadSizeBytes,
        },
        integrations: {
            databaseConnected: true,
            driveConfigured,
            emailTransportConfigured,
            otpSecretConfigured: Boolean(otpSecret && otpSecret.length >= 32),
            uploadIntentSecretConfigured: Boolean(uploadSecret && uploadSecret.length >= 32),
        },
    };
}

export function formatDrivePathPreview(
    activeTermName: string | null,
    driveFolderSegment: string,
): string {
    const termPart = activeTermName?.trim() || "Active Term";
    const segPart = driveFolderSegment.trim() || "<Folder Segment>";
    return `${termPart} / ${segPart} / General`;
}
