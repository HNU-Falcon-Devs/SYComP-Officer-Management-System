import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { academicTerms, officerAppointments } from "@/db/schema";
import { recomputeUserSystemRole } from "@/lib/admin/role-sync";
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

const uuidSchema = z.string().uuid("Invalid term ID.");

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "term:manage",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const termId = uuidSchema.parse(id);
        const now = new Date();
        const ip = getClientIp(request);

        const result = await db.transaction(async (tx) => {
            const [term] = await tx
                .select()
                .from(academicTerms)
                .where(eq(academicTerms.id, termId))
                .limit(1);

            if (!term) {
                return { kind: "not_found" as const };
            }
            if (term.status !== "ACTIVE") {
                return { kind: "invalid_status" as const, status: term.status };
            }

            const endedAppts = await tx
                .update(officerAppointments)
                .set({ isCurrent: false, endedAt: now, updatedAt: now })
                .where(
                    and(
                        eq(officerAppointments.academicTermId, term.id),
                        eq(officerAppointments.isCurrent, true),
                    ),
                )
                .returning({ userId: officerAppointments.userId });

            const [closedTerm] = await tx
                .update(academicTerms)
                .set({ status: "CLOSED", closedAt: now, updatedAt: now })
                .where(eq(academicTerms.id, term.id))
                .returning();

            const uniqueUserIds = new Set(endedAppts.map((a) => a.userId));
            let downgradedCount = 0;
            for (const uid of uniqueUserIds) {
                const sync = await recomputeUserSystemRole(tx, uid, null, now);
                if (sync?.downgraded) {
                    downgradedCount++;
                }
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "TERM_CLOSED",
                entityType: "academic_term",
                entityId: closedTerm.id,
                beforeState: { status: "ACTIVE" },
                afterState: {
                    status: "CLOSED",
                    endedAppointmentsCount: endedAppts.length,
                    downgradedCount,
                },
                ipAddress: ip,
            });

            return {
                kind: "ok" as const,
                closedTerm,
                endedAppointmentsCount: endedAppts.length,
                downgradedCount,
            };
        });

        if (result.kind === "not_found") {
            return apiError(404, "TERM_NOT_FOUND", "Academic term not found.");
        }
        if (result.kind === "invalid_status") {
            return apiError(
                409,
                "INVALID_TERM_STATE",
                `Only ACTIVE terms can be closed (current status: ${result.status}).`,
            );
        }

        return apiJson({
            term: {
                id: result.closedTerm.id,
                code: result.closedTerm.code,
                status: result.closedTerm.status,
                closedAt: result.closedTerm.closedAt?.toISOString() ?? null,
            },
            endedAppointmentsCount: result.endedAppointmentsCount,
            downgradedCount: result.downgradedCount,
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
