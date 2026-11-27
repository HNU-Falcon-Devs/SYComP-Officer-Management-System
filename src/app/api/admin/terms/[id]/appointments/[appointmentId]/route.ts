import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
    academicTerms,
    eventCommittees,
    events,
    officerAppointments,
} from "@/db/schema";
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

const uuidSchema = z.string().uuid("Invalid ID.");

const endAppointmentSchema = z.object({
    action: z.literal("END").default("END"),
    breakGlass: z.boolean().optional(),
    reason: z.string().optional(),
});

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string; appointmentId: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { id, appointmentId } = await context.params;
        const termId = uuidSchema.parse(id);
        const apptId = uuidSchema.parse(appointmentId);

        const body = await request.json().catch(() => ({}));
        const input = endAppointmentSchema.parse(body);

        const [term] = await db
            .select()
            .from(academicTerms)
            .where(eq(academicTerms.id, termId))
            .limit(1);

        if (!term) {
            await authorize(
                { actor: session?.user ?? null },
                "appointment:manage",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "TERM_NOT_FOUND", "Academic term not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "appointment:manage",
            { termStatus: term.status, academicTermId: term.id },
            createDrizzleAuthorizeDeps(db),
        );

        const now = new Date();
        const ip = getClientIp(request);

        const result = await db.transaction(async (tx) => {
            const [appt] = await tx
                .select()
                .from(officerAppointments)
                .where(
                    and(
                        eq(officerAppointments.id, apptId),
                        eq(officerAppointments.academicTermId, term.id),
                    ),
                )
                .limit(1);

            if (!appt) {
                return { kind: "not_found" as const };
            }
            if (!appt.isCurrent) {
                return { kind: "already_ended" as const };
            }

            const [ended] = await tx
                .update(officerAppointments)
                .set({ isCurrent: false, endedAt: now, updatedAt: now })
                .where(eq(officerAppointments.id, appt.id))
                .returning();

            const syncResult =
                term.status === "ACTIVE"
                    ? await recomputeUserSystemRole(tx, appt.userId, term.id, now)
                    : null;

            const headedActiveCommittees = await tx
                .select({
                    committeeId: eventCommittees.id,
                    committeeName: eventCommittees.name,
                    eventId: events.id,
                    eventTitle: events.title,
                })
                .from(eventCommittees)
                .innerJoin(events, eq(eventCommittees.eventId, events.id))
                .where(
                    and(
                        eq(eventCommittees.headUserId, appt.userId),
                        eq(events.academicTermId, term.id),
                        inArray(events.status, ["APPROVED", "PUBLISHED"]),
                    ),
                );

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "OFFICER_ENDED",
                entityType: "officer_appointment",
                entityId: ended.id,
                beforeState: {
                    isCurrent: true,
                    positionTitle: appt.positionTitle,
                    grantedSystemRole: appt.grantedSystemRole,
                },
                afterState: {
                    isCurrent: false,
                    endedAt: now.toISOString(),
                    nextSystemRole: syncResult?.nextRole ?? null,
                    sessionsRevoked: syncResult?.sessionsRevoked ?? false,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return {
                kind: "ok" as const,
                ended,
                syncResult,
                headedActiveCommittees,
            };
        });

        if (result.kind === "not_found") {
            return apiError(404, "APPOINTMENT_NOT_FOUND", "Officer appointment not found.");
        }
        if (result.kind === "already_ended") {
            return apiError(409, "APPOINTMENT_ALREADY_ENDED", "Appointment has already ended.");
        }

        return apiJson({
            appointment: {
                id: result.ended.id,
                isCurrent: result.ended.isCurrent,
                endedAt: result.ended.endedAt?.toISOString() ?? null,
            },
            roleSync: result.syncResult,
            headedActiveCommittees: result.headedActiveCommittees,
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
