import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents, documentTypes } from "@/db/schema";
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
import { validateExternalDriveUrl } from "@/lib/drive/classifier";
import { loadDocumentByIdWithContext, resolveDocumentTargetContext } from "@/lib/drive/queries";
import { externalDocumentSchema } from "@/lib/drive/validation";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = externalDocumentSchema.parse(body);

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

        const now = new Date();
        const rateLimit = await consumeRateLimit(db, {
            key: `doc:external:user:${actor.id}`,
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
                "Too many document link requests. Please try again later.",
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
                "Selected document type is inactive and cannot accept new documents.",
            );
        }

        const urlCheck = validateExternalDriveUrl(input.webViewLink);
        if (!urlCheck.ok) {
            return apiError(400, "INVALID_EXTERNAL_URL", urlCheck.message);
        }

        const ip = getClientIp(request);

        const insertedId = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(documents)
                .values({
                    academicTermId: targetCtx.academicTerm.id,
                    documentTypeId: docType.id,
                    eventId: targetCtx.event?.id ?? null,
                    meetingId: targetCtx.meeting?.id ?? null,
                    isProposalAttachment: input.isProposalAttachment,
                    title: input.title,
                    status: input.initialStatus,
                    storageMode: "EXTERNAL_LINK",
                    driveFileId: null,
                    driveFolderCacheId: null,
                    webViewLink: urlCheck.normalizedUrl,
                    originalFilename: null,
                    mimeType: null,
                    fileSizeBytes: null,
                    uploadedBy: actor.id,
                    approvedBy: null,
                    approvedAt: null,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: documents.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "DOCUMENT_EXTERNAL_LINKED",
                entityType: "document",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    title: input.title,
                    documentTypeId: docType.id,
                    eventId: targetCtx.event?.id ?? null,
                    meetingId: targetCtx.meeting?.id ?? null,
                    isProposalAttachment: input.isProposalAttachment,
                    status: input.initialStatus,
                    storageMode: "EXTERNAL_LINK",
                    webViewLink: urlCheck.normalizedUrl,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        const loaded = await loadDocumentByIdWithContext(db, insertedId);
        return apiJson({ document: loaded?.dto }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
