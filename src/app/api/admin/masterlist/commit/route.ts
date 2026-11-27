import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { academicTerms, masterlistImports, userSessions, users } from "@/db/schema";
import {
    buildMasterlistPreview,
    hashRowsWithBoundedConcurrency,
    MasterlistParseError,
    MAX_MASTERLIST_ROWS,
} from "@/lib/admin/masterlist";
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

const commitRowSchema = z.object({
    rowNumber: z.number().int().positive(),
    studentIdNumber: z.string().max(64),
    firstName: z.string().max(120),
    middleName: z.string().max(120).nullable(),
    lastName: z.string().max(120),
    fullName: z.string().max(260),
});

const commitSchema = z.object({
    sourceFilename: z.string().trim().min(1).max(255),
    rows: z.array(commitRowSchema).min(1).max(MAX_MASTERLIST_ROWS),
    flagMissingAsNeedsReview: z.boolean().default(true),
});

const INSERT_CHUNK_SIZE = 200;

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "masterlist:import",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const body = await request.json().catch(() => null);
        const input = commitSchema.parse(body);

        const [activeTerm] = await db
            .select({ id: academicTerms.id, code: academicTerms.code })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            return apiError(
                409,
                "NO_ACTIVE_TERM",
                "An ACTIVE academic term is required before committing a masterlist.",
            );
        }

        const preview = await buildMasterlistPreview(db, input.rows, input.sourceFilename);
        if (preview.hasBlockingErrors) {
            return apiError(
                400,
                "MASTERLIST_HAS_BLOCKING_WARNINGS",
                "Resolve duplicate, malformed, or formula-prefixed rows before committing.",
                { warnings: preview.warnings.filter((w) => w.blocking) },
            );
        }

        // Hash default passwords outside the DB transaction with bounded concurrency
        const hashedRows = await hashRowsWithBoundedConcurrency(preview.toCreate, 8);
        const now = new Date();
        const ip = getClientIp(request);

        const committed = await db.transaction(async (tx) => {
            let createdCount = 0;

            for (let i = 0; i < hashedRows.length; i += INSERT_CHUNK_SIZE) {
                const chunk = hashedRows.slice(i, i + INSERT_CHUNK_SIZE);
                const inserted = await tx
                    .insert(users)
                    .values(
                        chunk.map((row) => ({
                            studentIdNumber: row.studentIdNumber,
                            firstName: row.firstName,
                            middleName: row.middleName,
                            lastName: row.lastName,
                            fullName: row.fullName,
                            passwordHash: row.passwordHash,
                            mustChangePassword: true,
                            systemRole: "MEMBER" as const,
                            accountStatus: "ACTIVE" as const,
                            createdAt: now,
                            updatedAt: now,
                        })),
                    )
                    .onConflictDoNothing({ target: users.studentIdNumber })
                    .returning({ id: users.id });

                createdCount += inserted.length;
            }

            const missingToFlag = input.flagMissingAsNeedsReview
                ? preview.missingFromMasterlist
                : [];
            const missingIds = missingToFlag.map((m) => m.userId);

            if (missingIds.length > 0) {
                await tx
                    .update(users)
                    .set({
                        accountStatus: "NEEDS_REVIEW",
                        statusReason: "MISSING_FROM_MASTERLIST",
                        updatedAt: now,
                    })
                    .where(and(inArray(users.id, missingIds), eq(users.accountStatus, "ACTIVE")));

                await tx
                    .update(userSessions)
                    .set({ revokedAt: now })
                    .where(
                        and(
                            inArray(userSessions.userId, missingIds),
                            isNull(userSessions.revokedAt),
                        ),
                    );
            }

            const flaggedReviewCount = preview.warnings.length + missingToFlag.length;
            const reportSummary = {
                warnings: preview.warnings,
                flaggedMissing: missingToFlag,
            };

            const [importRecord] = await tx
                .insert(masterlistImports)
                .values({
                    academicTermId: activeTerm.id,
                    uploadedBy: actor.id,
                    sourceFilename: input.sourceFilename,
                    totalRows: preview.totalRows,
                    createdCount,
                    skippedExistingCount: preview.existingActive.length,
                    flaggedReviewCount,
                    reportSummary,
                    createdAt: now,
                })
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "MASTERLIST_IMPORTED",
                entityType: "masterlist_import",
                entityId: importRecord.id,
                afterState: {
                    academicTermId: activeTerm.id,
                    sourceFilename: input.sourceFilename,
                    totalRows: preview.totalRows,
                    createdCount,
                    skippedExistingCount: preview.existingActive.length,
                    flaggedReviewCount,
                },
                ipAddress: ip,
            });

            return importRecord;
        });

        return apiJson(
            {
                importRecord: {
                    ...committed,
                    createdAt: committed.createdAt.toISOString(),
                },
            },
            201,
        );
    } catch (error) {
        if (error instanceof MasterlistParseError) {
            return apiError(error.status, error.code, error.message);
        }
        return apiErrorResponse(error);
    }
}
