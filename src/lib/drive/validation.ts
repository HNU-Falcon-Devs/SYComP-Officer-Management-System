import { z } from "zod";
import { isValidCalendarDate } from "@/lib/admin/audit-logs";
import { validateExternalDriveUrl } from "./classifier";

export const DOCUMENT_STATUSES = [
    "DRAFT",
    "FOR_REVIEW",
    "SUBMITTED",
    "APPROVED",
    "ARCHIVED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_INITIAL_STATUSES = ["DRAFT", "FOR_REVIEW"] as const;
export type DocumentInitialStatus = (typeof DOCUMENT_INITIAL_STATUSES)[number];

export const DOCUMENT_STORAGE_MODES = ["DRIVE_UPLOAD", "EXTERNAL_LINK"] as const;
export type DocumentStorageMode = (typeof DOCUMENT_STORAGE_MODES)[number];

export const DOCUMENTS_DEFAULT_LIMIT = 25;
export const DOCUMENTS_MAX_LIMIT = 100;

export const ALLOWED_DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
    DRAFT: ["FOR_REVIEW", "ARCHIVED"],
    FOR_REVIEW: ["SUBMITTED", "ARCHIVED"],
    SUBMITTED: ["FOR_REVIEW", "APPROVED", "ARCHIVED"],
    APPROVED: ["ARCHIVED"],
    ARCHIVED: [],
};

export function isApprovalOrArchiveTransition(from: DocumentStatus, to: DocumentStatus): boolean {
    if (from === to) return false;
    return to === "APPROVED" || to === "ARCHIVED" || (from === "SUBMITTED" && to === "FOR_REVIEW");
}

export function getAvailableDocumentTransitions(
    status: DocumentStatus,
    canApprove: boolean,
): DocumentStatus[] {
    return ALLOWED_DOCUMENT_TRANSITIONS[status].filter((next) => {
        if (isApprovalOrArchiveTransition(status, next)) {
            return canApprove;
        }
        return true;
    });
}

const optionalUuid = z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().uuid("Invalid identifier.").optional(),
);

export const uploadInitSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(2, "Document title must be at least 2 characters.")
            .max(200, "Document title must be at most 200 characters."),
        documentTypeId: z.string().uuid("Invalid document type ID."),
        eventId: optionalUuid,
        meetingId: optionalUuid,
        isProposalAttachment: z.boolean().default(false),
        initialStatus: z.enum(DOCUMENT_INITIAL_STATUSES).default("DRAFT"),
        filename: z.string().trim().min(1, "Filename is required.").max(255),
        mimeType: z.string().trim().min(1, "MIME type is required.").max(128),
        fileSizeBytes: z.coerce.number().int().positive("File size must be greater than 0."),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .refine((d) => !(d.eventId && d.meetingId), {
        message: "A document cannot be linked to both an event and a meeting.",
        path: ["meetingId"],
    })
    .refine((d) => !d.isProposalAttachment || Boolean(d.eventId), {
        message: "Proposal attachments must be linked to an event.",
        path: ["isProposalAttachment"],
    });

export const uploadFinalizeSchema = z.object({
    driveFileId: z
        .string()
        .trim()
        .min(4, "Drive file ID is required.")
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/, "Invalid Google Drive file ID."),
    uploadIntentToken: z.string().trim().min(10, "Upload intent token is required."),
    breakGlass: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
});

export const externalDocumentSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(2, "Document title must be at least 2 characters.")
            .max(200, "Document title must be at most 200 characters."),
        documentTypeId: z.string().uuid("Invalid document type ID."),
        eventId: optionalUuid,
        meetingId: optionalUuid,
        isProposalAttachment: z.boolean().default(false),
        initialStatus: z.enum(DOCUMENT_INITIAL_STATUSES).default("DRAFT"),
        webViewLink: z.string().trim().min(1, "Google Drive URL is required.").max(2000),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .refine((d) => !(d.eventId && d.meetingId), {
        message: "A document cannot be linked to both an event and a meeting.",
        path: ["meetingId"],
    })
    .refine((d) => !d.isProposalAttachment || Boolean(d.eventId), {
        message: "Proposal attachments must be linked to an event.",
        path: ["isProposalAttachment"],
    })
    .superRefine((d, ctx) => {
        const result = validateExternalDriveUrl(d.webViewLink);
        if (!result.ok) {
            ctx.addIssue({
                code: "custom",
                path: ["webViewLink"],
                message: result.message,
            });
        }
    });

export const updateDocumentSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(2, "Document title must be at least 2 characters.")
            .max(200, "Document title must be at most 200 characters.")
            .optional(),
        status: z.enum(DOCUMENT_STATUSES).optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((d) => d.title !== undefined || d.status !== undefined, {
        message: "Provide a title or status to update.",
    });

export const documentsListQuerySchema = z
    .object({
        academicTermId: optionalUuid,
        documentTypeId: optionalUuid,
        eventId: optionalUuid,
        meetingId: optionalUuid,
        status: z.enum(DOCUMENT_STATUSES).optional(),
        storageMode: z.enum(DOCUMENT_STORAGE_MODES).optional(),
        q: z.string().trim().max(100).optional(),
        from: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        to: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        includeMeta: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(DOCUMENTS_MAX_LIMIT)
            .default(DOCUMENTS_DEFAULT_LIMIT),
    })
    .refine((d) => !d.from || !d.to || d.to >= d.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export type DocumentsListQuery = z.infer<typeof documentsListQuerySchema>;

export function parseDocumentsSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        academicTermId: getParam("academicTermId"),
        documentTypeId: getParam("documentTypeId"),
        eventId: getParam("eventId"),
        meetingId: getParam("meetingId"),
        status: getParam("status"),
        storageMode: getParam("storageMode"),
        q: getParam("q"),
        from: getParam("from"),
        to: getParam("to"),
        includeMeta: getParam("includeMeta"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

export interface DocumentActorSummary {
    id: string;
    studentIdNumber: string;
    fullName: string;
}

export interface DocumentDto {
    id: string;
    title: string;
    status: DocumentStatus;
    storageMode: DocumentStorageMode;
    isProposalAttachment: boolean;
    academicTerm: {
        id: string;
        code: string;
        name: string;
        status: "DRAFT" | "ACTIVE" | "CLOSED";
    };
    documentType: {
        id: string;
        name: string;
        slug: string;
        driveFolderSegment: string;
    };
    event: {
        id: string;
        title: string;
        slug: string;
        status: string;
    } | null;
    meeting: {
        id: string;
        title: string;
        status: string;
    } | null;
    driveFileId: string | null;
    drivePathDisplay: string;
    webViewLink: string;
    previewEmbedUrl: string | null;
    originalFilename: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    uploadedBy: DocumentActorSummary | null;
    approvedBy: DocumentActorSummary | null;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ActiveDocumentTypeOption {
    id: string;
    name: string;
    slug: string;
    driveFolderSegment: string;
}

export interface DocumentTermOption {
    id: string;
    code: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
}

export interface DocumentEventOption {
    id: string;
    title: string;
    slug: string;
    status: string;
    academicTermId: string;
    academicTermCode: string;
    academicTermName: string;
    academicTermStatus: "DRAFT" | "ACTIVE" | "CLOSED";
}

export function formatFileSizeBytes(bytes: number | null): string {
    if (bytes === null || !Number.isFinite(bytes)) {
        return "External link";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
