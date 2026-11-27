import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents, documentTypes, users } from "@/db/schema";
import {
    isPgUniqueViolation,
    updateDocumentTypeSchema,
    type DocumentTypeDto,
} from "@/lib/admin/settings";
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

const uuidSchema = z.string().uuid("Invalid document type ID.");

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "document_type:manage",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const docTypeId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = updateDocumentTypeSchema.parse(body);

        const now = new Date();
        const ip = getClientIp(request);

        const outcome = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(documentTypes)
                .where(eq(documentTypes.id, docTypeId))
                .limit(1);

            if (!existing) {
                return { kind: "not_found" as const };
            }

            const nextName = input.name ?? existing.name;
            const nextSegment = input.driveFolderSegment ?? existing.driveFolderSegment;
            const nextIsActive = input.isActive ?? existing.isActive;

            const metadataChanged =
                nextName !== existing.name || nextSegment !== existing.driveFolderSegment;
            const statusChanged = nextIsActive !== existing.isActive;

            let docType = existing;
            if (metadataChanged || statusChanged) {
                const [updated] = await tx
                    .update(documentTypes)
                    .set({
                        name: nextName,
                        driveFolderSegment: nextSegment,
                        isActive: nextIsActive,
                        updatedAt: now,
                    })
                    .where(eq(documentTypes.id, existing.id))
                    .returning();

                docType = updated;

                await writeAuditLog(tx, {
                    actorId: actor.id,
                    action: metadataChanged
                        ? "DOCUMENT_TYPE_UPDATED"
                        : "DOCUMENT_TYPE_STATUS_CHANGED",
                    entityType: "document_type",
                    entityId: updated.id,
                    beforeState: {
                        name: existing.name,
                        slug: existing.slug,
                        driveFolderSegment: existing.driveFolderSegment,
                        isActive: existing.isActive,
                    },
                    afterState: {
                        name: updated.name,
                        slug: updated.slug,
                        driveFolderSegment: updated.driveFolderSegment,
                        isActive: updated.isActive,
                    },
                    reason: input.reason?.trim() || null,
                    ipAddress: ip,
                });
            }

            const [[{ total }], [creator]] = await Promise.all([
                tx
                    .select({ total: count() })
                    .from(documents)
                    .where(eq(documents.documentTypeId, docType.id)),
                tx
                    .select({
                        id: users.id,
                        studentIdNumber: users.studentIdNumber,
                        fullName: users.fullName,
                    })
                    .from(users)
                    .where(eq(users.id, docType.createdBy))
                    .limit(1),
            ]);

            return {
                kind: "ok" as const,
                docType,
                documentCount: Number(total),
                creator: creator ?? null,
            };
        });

        if (outcome.kind === "not_found") {
            return apiError(404, "DOCUMENT_TYPE_NOT_FOUND", "Document type not found.");
        }

        const dto: DocumentTypeDto = {
            id: outcome.docType.id,
            name: outcome.docType.name,
            slug: outcome.docType.slug,
            driveFolderSegment: outcome.docType.driveFolderSegment,
            isActive: outcome.docType.isActive,
            documentCount: outcome.documentCount,
            createdBy: outcome.creator,
            createdAt: outcome.docType.createdAt.toISOString(),
            updatedAt: outcome.docType.updatedAt.toISOString(),
        };

        return apiJson({ documentType: dto });
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "DOCUMENT_TYPE_CONFLICT",
                "A document type with that name already exists.",
            );
        }
        return apiErrorResponse(error);
    }
}
