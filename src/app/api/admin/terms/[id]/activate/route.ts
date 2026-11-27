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
            const [targetTerm] = await tx
                .select()
                .from(academicTerms)
                .where(eq(academicTerms.id, termId))
                .limit(1);

            if (!targetTerm) {
                return { kind: "not_found" as const };
            }
            if (targetTerm.status !== "DRAFT") {
                return { kind: "invalid_status" as const, status: targetTerm.status };
            }

            const [outgoingTerm] = await tx
                .select()
                .from(academicTerms)
                .where(eq(academicTerms.status, "ACTIVE"))
                .limit(1);

            const affectedUserIds = new Set<string>();
            let endedAppointmentsCount = 0;

            if (outgoingTerm) {
                const outgoingAppts = await tx
                    .update(officerAppointments)
                    .set({ isCurrent: false, endedAt: now, updatedAt: now })
                    .where(
                        and(
                            eq(officerAppointments.academicTermId, outgoingTerm.id),
                            eq(officerAppointments.isCurrent, true),
                        ),
                    )
                    .returning({ userId: officerAppointments.userId });

                endedAppointmentsCount = outgoingAppts.length;
                for (const appt of outgoingAppts) {
                    affectedUserIds.add(appt.userId);
                }

                await tx
                    .update(academicTerms)
                    .set({ status: "CLOSED", closedAt: now, updatedAt: now })
                    .where(eq(academicTerms.id, outgoingTerm.id));

                await writeAuditLog(tx, {
                    actorId: actor.id,
                    action: "TERM_CLOSED",
                    entityType: "academic_term",
                    entityId: outgoingTerm.id,
                    beforeState: { status: "ACTIVE" },
                    afterState: { status: "CLOSED", endedAppointmentsCount },
                    ipAddress: ip,
                });
            }

            // Activate target DRAFT term BEFORE recomputing roles so pre-staged appointments promote cleanly
            const [activatedTerm] = await tx
                .update(academicTerms)
                .set({ status: "ACTIVE", activatedAt: now, updatedAt: now })
                .where(eq(academicTerms.id, targetTerm.id))
                .returning();

            const incomingAppts = await tx
                .select({ userId: officerAppointments.userId })
                .from(officerAppointments)
                .where(
                    and(
                        eq(officerAppointments.academicTermId, activatedTerm.id),
                        eq(officerAppointments.isCurrent, true),
                    ),
                );

            for (const appt of incomingAppts) {
                affectedUserIds.add(appt.userId);
            }

            let downgradedCount = 0;
            for (const uid of affectedUserIds) {
                const sync = await recomputeUserSystemRole(tx, uid, activatedTerm.id, now);
                if (sync?.downgraded) {
                    downgradedCount++;
                }
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "TERM_ACTIVATED",
                entityType: "academic_term",
                entityId: activatedTerm.id,
                beforeState: { status: "DRAFT" },
                afterState: {
                    status: "ACTIVE",
                    closedTermId: outgoingTerm?.id ?? null,
                    endedAppointmentsCount,
                    downgradedCount,
                },
                ipAddress: ip,
            });

            return {
                kind: "ok" as const,
                activatedTerm,
                closedTermId: outgoingTerm?.id ?? null,
                endedAppointmentsCount,
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
                `Only DRAFT terms can be activated (current status: ${result.status}).`,
            );
        }

        return apiJson({
            term: {
                id: result.activatedTerm.id,
                code: result.activatedTerm.code,
                name: result.activatedTerm.name,
                status: result.activatedTerm.status,
                activatedAt: result.activatedTerm.activatedAt?.toISOString() ?? null,
            },
            rollover: {
                closedTermId: result.closedTermId,
                endedAppointmentsCount: result.endedAppointmentsCount,
                downgradedCount: result.downgradedCount,
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
