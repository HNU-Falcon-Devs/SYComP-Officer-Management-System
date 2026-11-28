import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
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
import { loadDocumentByIdWithContext } from "@/lib/drive/queries";
import {
    ALLOWED_DOCUMENT_TRANSITIONS,
    isApprovalOrArchiveTransition,
    updateDocumentSchema,
    type DocumentStatus,
} from "@/lib/drive/validation";

const uuidSchema = z.string().uuid("Invalid document ID.");

function resolveAuditAction(from: DocumentStatus, to: DocumentStatus): string {
    if (from !== to) {
        if (to === "APPROVED") return "DOCUMENT_APPROVED";
        if (to === "ARCHIVED") return "DOCUMENT_ARCHIVED";
        if (from === "SUBMITTED" && to === "FOR_REVIEW") return "DOCUMENT_RETURNED_FOR_REVISION";
    }
    return "DOCUMENT_UPDATED";
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "document:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const documentId = uuidSchema.parse(id);

        const loaded = await loadDocumentByIdWithContext(db, documentId);
        if (!loaded) {
            return apiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
        }

        return apiJson({ document: loaded.dto }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { id } = await context.params;
        const documentId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = updateDocumentSchema.parse(body);

        const loaded = await loadDocumentByIdWithContext(db, documentId);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "document:upload",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
        }

        const currentStatus = loaded.raw.status;
        const requestedStatus = input.status ?? currentStatus;
        const requiresApprovePermission =
            isApprovalOrArchiveTransition(currentStatus, requestedStatus) ||
            currentStatus === "APPROVED" ||
            currentStatus === "ARCHIVED";

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            requiresApprovePermission ? "document:approve" : "document:upload",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.eventStatus,
                meetingStatus: loaded.meetingStatus,
                academicTermId: loaded.raw.academicTermId,
            },
            createDrizzleAuthorizeDeps(db),
        );

        if (currentStatus === "ARCHIVED") {
            return apiError(
                409,
                "INVALID_DOCUMENT_TRANSITION",
                "Archived documents are locked and cannot be modified.",
            );
        }

        if (
            input.status !== undefined &&
            input.status !== currentStatus &&
            !ALLOWED_DOCUMENT_TRANSITIONS[currentStatus].includes(input.status)
        ) {
            return apiError(
                409,
                "INVALID_DOCUMENT_TRANSITION",
                `Cannot transition document from ${currentStatus} to ${input.status}.`,
            );
        }

        const now = new Date();
        const ip = getClientIp(request);

        const txResult = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(documents)
                .where(eq(documents.id, documentId))
                .limit(1);

            if (!existing) {
                return { kind: "not_found" as const };
            }

            if (existing.status === "ARCHIVED") {
                return { kind: "archived" as const };
            }

            const nextTitle = input.title ?? existing.title;
            const nextStatus = input.status ?? existing.status;

            if (
                nextStatus !== existing.status &&
                !ALLOWED_DOCUMENT_TRANSITIONS[existing.status].includes(nextStatus)
            ) {
                return { kind: "invalid_transition" as const };
            }

            const titleChanged = nextTitle !== existing.title;
            const statusChanged = nextStatus !== existing.status;

            if (!titleChanged && !statusChanged) {
                return { kind: "unchanged" as const };
            }

            const transitioningToApproved = statusChanged && nextStatus === "APPROVED";
            const nextApprovedBy = transitioningToApproved ? actor.id : existing.approvedBy;
            const nextApprovedAt = transitioningToApproved ? now : existing.approvedAt;

            const [updated] = await tx
                .update(documents)
                .set({
                    title: nextTitle,
                    status: nextStatus,
                    approvedBy: nextApprovedBy,
                    approvedAt: nextApprovedAt,
                    updatedAt: now,
                })
                .where(eq(documents.id, existing.id))
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: resolveAuditAction(existing.status, updated.status),
                entityType: "document",
                entityId: updated.id,
                beforeState: {
                    title: existing.title,
                    status: existing.status,
                    approvedBy: existing.approvedBy,
                    approvedAt: existing.approvedAt?.toISOString() ?? null,
                },
                afterState: {
                    title: updated.title,
                    status: updated.status,
                    approvedBy: updated.approvedBy,
                    approvedAt: updated.approvedAt?.toISOString() ?? null,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return { kind: "updated" as const };
        });

        if (txResult.kind === "not_found") {
            return apiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
        }
        if (txResult.kind === "archived" || txResult.kind === "invalid_transition") {
            return apiError(
                409,
                "INVALID_DOCUMENT_TRANSITION",
                "Document state transition is no longer valid.",
            );
        }

        const refreshed = await loadDocumentByIdWithContext(db, documentId);
        return apiJson(
            { document: refreshed?.dto ?? loaded.dto },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
