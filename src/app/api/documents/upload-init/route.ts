import { eq } from "drizzle-orm";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { documentTypes } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getServerSession,
} from "@/lib/auth/server";
import { DriveServiceError, getDriveProvider } from "@/lib/drive/adapter";
import { resolveDriveFolderPath, validateUploadFileDescriptor } from "@/lib/drive/classifier";
import { ensureDriveFolderHierarchy, signUploadIntentToken } from "@/lib/drive/client";
import { resolveDocumentTargetContext } from "@/lib/drive/queries";
import { uploadInitSchema } from "@/lib/drive/validation";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = uploadInitSchema.parse(body);

        const targetCtx = await resolveDocumentTargetContext(db, {
            eventId: input.eventId,
            meetingId: input.meetingId,
        });

        if (!targetCtx.ok) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "document:upload",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(targetCtx.status, targetCtx.code, targetCtx.message);
        }

        const { actor } = await authorize(
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

        const now = new Date();
        const rateLimit = await consumeRateLimit(db, {
            key: `doc:upload-init:user:${actor.id}`,
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
                "Too many document upload attempts. Please try again later.",
                undefined,
                { "Retry-After": String(retryAfter) },
            );
        }

        const [docType] = await db
            .select()
            .from(documentTypes)
            .where(eq(documentTypes.id, input.documentTypeId))
            .limit(1);

        if (!docType) {
            return apiError(404, "DOCUMENT_TYPE_NOT_FOUND", "Document type not found.");
        }
        if (!docType.isActive) {
            return apiError(
                409,
                "DOCUMENT_TYPE_INACTIVE",
                "Selected document type is inactive and cannot accept new uploads.",
            );
        }

        const env = getEnv();
        const fileCheck = validateUploadFileDescriptor({
            filename: input.filename,
            mimeType: input.mimeType,
            fileSizeBytes: input.fileSizeBytes,
            maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
        });
        if (!fileCheck.ok) {
            return apiError(fileCheck.status, fileCheck.code, fileCheck.message);
        }

        const resolvedPath = resolveDriveFolderPath({
            academicTermName: targetCtx.academicTerm.name,
            academicTermCode: targetCtx.academicTerm.code,
            documentTypeSegment: docType.driveFolderSegment,
            documentTypeSlug: docType.slug,
            eventTitle: targetCtx.event?.title ?? null,
            eventSlug: targetCtx.event?.slug ?? null,
            isProposal: input.isProposalAttachment,
        });

        const provider = getDriveProvider(env);
        const folder = await ensureDriveFolderHierarchy(db, provider, {
            academicTermId: targetCtx.academicTerm.id,
            path: resolvedPath,
        });

        const originHeader = request.headers.get("origin");
        const resumable = await provider.createResumableUploadSession({
            actorId: actor.id,
            parentFolderId: folder.driveFolderId,
            filename: fileCheck.sanitizedFilename,
            mimeType: fileCheck.canonicalMimeType,
            fileSizeBytes: input.fileSizeBytes,
            maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
            origin: originHeader ?? env.APP_URL,
        });

        const uploadIntentToken = signUploadIntentToken(
            {
                actorId: actor.id,
                academicTermId: targetCtx.academicTerm.id,
                documentTypeId: docType.id,
                eventId: targetCtx.event?.id ?? null,
                meetingId: targetCtx.meeting?.id ?? null,
                isProposalAttachment: input.isProposalAttachment,
                title: input.title,
                initialStatus: input.initialStatus,
                driveFolderCacheId: folder.folderCacheId,
                parentDriveFolderId: folder.driveFolderId,
                expectedFilename: fileCheck.sanitizedFilename,
                expectedExtension: fileCheck.extension,
                expectedMimeType: fileCheck.canonicalMimeType,
            },
            env.UPLOAD_INTENT_SECRET,
            now.getTime(),
        );

        return apiJson(
            {
                uploadUrl: resumable.uploadUrl,
                uploadIntentToken,
                folderCacheId: folder.folderCacheId,
                drivePathDisplay: resolvedPath.displayPath,
                driveProviderMode: provider.mode,
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (error instanceof DriveServiceError) {
            return apiError(error.status, error.code, error.message);
        }
        return apiErrorResponse(error);
    }
}
