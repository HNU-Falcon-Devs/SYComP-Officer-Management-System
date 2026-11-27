import { asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents, documentTypes, users } from "@/db/schema";
import {
    createDocumentTypeSchema,
    documentTypeSlugSchema,
    isPgUniqueViolation,
    slugifyDocumentTypeName,
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

const listQuerySchema = z.object({
    includeInactive: z.enum(["true", "false"]).default("true"),
});

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "document_type:manage",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const query = listQuerySchema.parse({
            includeInactive: url.searchParams.get("includeInactive") || undefined,
        });
        const includeInactive = query.includeInactive === "true";

        const [rows, docCounts] = await Promise.all([
            db
                .select({
                    id: documentTypes.id,
                    name: documentTypes.name,
                    slug: documentTypes.slug,
                    driveFolderSegment: documentTypes.driveFolderSegment,
                    isActive: documentTypes.isActive,
                    createdAt: documentTypes.createdAt,
                    updatedAt: documentTypes.updatedAt,
                    creatorId: users.id,
                    creatorStudentIdNumber: users.studentIdNumber,
                    creatorFullName: users.fullName,
                })
                .from(documentTypes)
                .leftJoin(users, eq(documentTypes.createdBy, users.id))
                .where(includeInactive ? undefined : eq(documentTypes.isActive, true))
                .orderBy(desc(documentTypes.isActive), asc(documentTypes.name)),
            db
                .select({
                    documentTypeId: documents.documentTypeId,
                    total: count(),
                })
                .from(documents)
                .groupBy(documents.documentTypeId),
        ]);

        const countMap = new Map(docCounts.map((c) => [c.documentTypeId, Number(c.total)]));

        const list: DocumentTypeDto[] = rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            driveFolderSegment: row.driveFolderSegment,
            isActive: row.isActive,
            documentCount: countMap.get(row.id) ?? 0,
            createdBy: row.creatorId
                ? {
                      id: row.creatorId,
                      studentIdNumber: row.creatorStudentIdNumber ?? "",
                      fullName: row.creatorFullName ?? "",
                  }
                : null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        }));

        return apiJson({ documentTypes: list }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(request: Request) {
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

        const body = await request.json().catch(() => null);
        const input = createDocumentTypeSchema.parse(body);
        const resolvedSlug = documentTypeSlugSchema.parse(
            input.slug ?? slugifyDocumentTypeName(input.name),
        );
        const ip = getClientIp(request);

        const created = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(documentTypes)
                .values({
                    name: input.name,
                    slug: resolvedSlug,
                    driveFolderSegment: input.driveFolderSegment,
                    isActive: true,
                    createdBy: actor.id,
                })
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "DOCUMENT_TYPE_CREATED",
                entityType: "document_type",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    name: inserted.name,
                    slug: inserted.slug,
                    driveFolderSegment: inserted.driveFolderSegment,
                    isActive: inserted.isActive,
                },
                ipAddress: ip,
            });

            return inserted;
        });

        const dto: DocumentTypeDto = {
            id: created.id,
            name: created.name,
            slug: created.slug,
            driveFolderSegment: created.driveFolderSegment,
            isActive: created.isActive,
            documentCount: 0,
            createdBy: {
                id: actor.id,
                studentIdNumber: actor.studentIdNumber,
                fullName: actor.fullName,
            },
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
        };

        return apiJson({ documentType: dto }, 201);
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "DOCUMENT_TYPE_CONFLICT",
                "A document type with that name or slug already exists.",
            );
        }
        return apiErrorResponse(error);
    }
}
