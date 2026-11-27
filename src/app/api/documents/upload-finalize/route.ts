import { eq } from "drizzle-orm";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import { DriveServiceError, getDriveProvider, type DriveProvider } from "@/lib/drive/adapter";
import { ALLOWED_UPLOAD_EXTENSION_MIMES, verifyFileMagicBytes } from "@/lib/drive/classifier";
import { cleanupOrphanedDriveFile, verifyUploadIntentToken } from "@/lib/drive/client";
import { buildDrivePermissionPayload } from "@/lib/drive/permissions";
import { loadDocumentByIdWithContext, resolveDocumentTargetContext } from "@/lib/drive/queries";
import { uploadFinalizeSchema } from "@/lib/drive/validation";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
    const db = getDb();
    const ip = getClientIp(request);

    let cleanupDriveFileId: string | null = null;
    let cleanupProvider: DriveProvider | null = null;
    let cleanupActorId: string | null = null;

    try {
        assertSameOrigin(request);

        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = uploadFinalizeSchema.parse(body);

        if (!session?.user) {
            await authorize(
                { actor: null, breakGlass: input.breakGlass, reason: input.reason },
                "document:upload",
                {},
                createDrizzleAuthorizeDeps(db),
            );
        }

        const env = getEnv();
        const now = new Date();
        const intentResult = verifyUploadIntentToken(
            input.uploadIntentToken,
            env.UPLOAD_INTENT_SECRET,
            now.getTime(),
        );
        if (!intentResult.ok) {
            return apiError(400, "INVALID_UPLOAD_INTENT", intentResult.message);
        }

        const intent = intentResult.payload;
        if (intent.actorId !== session!.user.id) {
            return apiError(
                403,
                "FORBIDDEN",
                "Upload intent token does not belong to the authenticated user.",
            );
        }

        const targetCtx = await resolveDocumentTargetContext(db, {
            eventId: intent.eventId,
            meetingId: intent.meetingId,
        });
        if (!targetCtx.ok) {
            return apiError(targetCtx.status, targetCtx.code, targetCtx.message);
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "document:upload",
            {
                termStatus: targetCtx.academicTerm.status,
                eventStatus: targetCtx.event?.status,
                meetingStatus: targetCtx.meeting?.status,
                academicTermId: targetCtx.academicTerm.id,
            },
            createDrizzleAuthorizeDeps(db),
        );
        cleanupActorId = actor.id;

        const rateLimit = await consumeRateLimit(db, {
            key: `doc:upload-finalize:user:${actor.id}`,
            limit: 30,
            windowMs: 15 * 60 * 1000,
            now,
        });
        if (!rateLimit.allowed) {
            const retryAfter = Math.max(
                1,
                Math.ceil((rateLimit.resetAt.getTime() - now.getTime()) / 1000),
            );
            return apiError(
                429,
                "RATE_LIMITED",
                "Too many document upload finalizations. Please try again later.",
                undefined,
                { "Retry-After": String(retryAfter) },
            );
        }

        const [existingDoc] = await db
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.driveFileId, input.driveFileId))
            .limit(1);

        if (existingDoc) {
            return apiError(
                409,
                "DUPLICATE_DRIVE_FILE",
                "This Google Drive file has already been registered.",
            );
        }

        const provider = getDriveProvider(env);
        cleanupProvider = provider;
        cleanupDriveFileId = input.driveFileId;

        const meta = await provider.getFileMetadata(input.driveFileId);
        if (!meta || meta.trashed) {
            cleanupDriveFileId = null;
            return apiError(
                404,
                "DRIVE_FILE_NOT_FOUND",
                "Uploaded file was not found in Google Drive.",
            );
        }

        if (!meta.parents.includes(intent.parentDriveFolderId)) {
            await cleanupOrphanedDriveFile(db, provider, {
                driveFileId: input.driveFileId,
                actorId: actor.id,
                ipAddress: ip,
                cause: "INVALID_DRIVE_PARENT",
            });
            cleanupDriveFileId = null;
            return apiError(
                400,
                "INVALID_DRIVE_PARENT",
                "Uploaded file parent folder does not match the authorized Drive path.",
            );
        }

        if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > env.MAX_UPLOAD_SIZE_BYTES) {
            const status = meta.size > env.MAX_UPLOAD_SIZE_BYTES ? 413 : 400;
            const code = meta.size > env.MAX_UPLOAD_SIZE_BYTES ? "FILE_TOO_LARGE" : "EMPTY_FILE";
            await cleanupOrphanedDriveFile(db, provider, {
                driveFileId: input.driveFileId,
                actorId: actor.id,
                ipAddress: ip,
                cause: code,
            });
            cleanupDriveFileId = null;
            return apiError(
                status,
                code,
                code === "FILE_TOO_LARGE"
                    ? "Uploaded file exceeds the maximum allowed size."
                    : "Uploaded file is empty.",
            );
        }

        const normalizedDriveMime = meta.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
        const allowedMimes = ALLOWED_UPLOAD_EXTENSION_MIMES[intent.expectedExtension];
        if (!allowedMimes || !allowedMimes.includes(normalizedDriveMime)) {
            await cleanupOrphanedDriveFile(db, provider, {
                driveFileId: input.driveFileId,
                actorId: actor.id,
                ipAddress: ip,
                cause: "INVALID_FILE_TYPE",
            });
            cleanupDriveFileId = null;
            return apiError(
                400,
                "INVALID_FILE_TYPE",
                "Uploaded Drive file MIME type does not match the allowed format.",
            );
        }

        const headerBytes = await provider.readFileHeaderBytes(input.driveFileId, 64);
        if (!headerBytes || !verifyFileMagicBytes(intent.expectedExtension, headerBytes)) {
            await cleanupOrphanedDriveFile(db, provider, {
                driveFileId: input.driveFileId,
                actorId: actor.id,
                ipAddress: ip,
                cause: "INVALID_FILE_SIGNATURE",
            });
            cleanupDriveFileId = null;
            return apiError(
                400,
                "INVALID_FILE_SIGNATURE",
                "Uploaded file content signature does not match the declared file type.",
            );
        }

        const permissionPayload = buildDrivePermissionPayload({
            shareMode: env.DRIVE_SHARE_MODE,
            universityEmailDomain: env.UNIVERSITY_EMAIL_DOMAIN,
        });
        await provider.setFilePermission(input.driveFileId, permissionPayload);

        const canonicalMimeType = allowedMimes[0];
        const insertedId = await db.transaction(async (tx) => {
            const [duplicateCheck] = await tx
                .select({ id: documents.id })
                .from(documents)
                .where(eq(documents.driveFileId, input.driveFileId))
                .limit(1);

            if (duplicateCheck) {
                cleanupDriveFileId = null;
                throw new DriveServiceError(
                    409 as 400,
                    "DUPLICATE_DRIVE_FILE",
                    "This Google Drive file has already been registered.",
                );
            }

            const [inserted] = await tx
                .insert(documents)
                .values({
                    academicTermId: intent.academicTermId,
                    documentTypeId: intent.documentTypeId,
                    eventId: intent.eventId,
                    meetingId: intent.meetingId,
                    isProposalAttachment: intent.isProposalAttachment,
                    title: intent.title,
                    status: intent.initialStatus,
                    storageMode: "DRIVE_UPLOAD",
                    driveFileId: meta.id,
                    driveFolderCacheId: intent.driveFolderCacheId,
                    webViewLink: meta.webViewLink,
                    originalFilename: intent.expectedFilename,
                    mimeType: canonicalMimeType,
                    fileSizeBytes: meta.size,
                    uploadedBy: actor.id,
                    approvedBy: null,
                    approvedAt: null,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: documents.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "DOCUMENT_UPLOADED",
                entityType: "document",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    title: intent.title,
                    documentTypeId: intent.documentTypeId,
                    eventId: intent.eventId,
                    meetingId: intent.meetingId,
                    isProposalAttachment: intent.isProposalAttachment,
                    status: intent.initialStatus,
                    storageMode: "DRIVE_UPLOAD",
                    driveFileId: meta.id,
                    mimeType: canonicalMimeType,
                    fileSizeBytes: meta.size,
                    driveShareMode: env.DRIVE_SHARE_MODE,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        cleanupDriveFileId = null;

        const loaded = await loadDocumentByIdWithContext(db, insertedId);
        return apiJson({ document: loaded?.dto }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        if (cleanupDriveFileId && cleanupProvider) {
            const cause =
                error instanceof DriveServiceError
                    ? error.code
                    : error instanceof Error
                      ? error.message
                      : "UPLOAD_FINALIZE_FAILED";
            await cleanupOrphanedDriveFile(db, cleanupProvider, {
                driveFileId: cleanupDriveFileId,
                actorId: cleanupActorId,
                ipAddress: ip,
                cause,
            });
        }

        if (error instanceof DriveServiceError) {
            if (error.code === "DUPLICATE_DRIVE_FILE") {
                return apiError(409, error.code, error.message);
            }
            return apiError(error.status, error.code, error.message);
        }
        if (isPgUniqueViolation(error)) {
            return apiError(409, "DOCUMENT_CONFLICT", "Document record conflict.");
        }
        return apiErrorResponse(error);
    }
}
