import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { academicTerms, officerAppointments, users } from "@/db/schema";
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

const createAppointmentSchema = z.object({
    userId: z.string().uuid("Valid userId is required."),
    positionTitle: z.string().trim().min(2, "Position title is required.").max(120),
    grantedSystemRole: z.enum(["SUPER_ADMIN", "EXECUTIVE", "OFFICER"]),
    breakGlass: z.boolean().optional(),
    reason: z.string().optional(),
});

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "term:history:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const termId = uuidSchema.parse(id);

        const [term] = await db
            .select({ id: academicTerms.id })
            .from(academicTerms)
            .where(eq(academicTerms.id, termId))
            .limit(1);

        if (!term) {
            return apiError(404, "TERM_NOT_FOUND", "Academic term not found.");
        }

        const rows = await db
            .select({
                id: officerAppointments.id,
                userId: officerAppointments.userId,
                academicTermId: officerAppointments.academicTermId,
                positionTitle: officerAppointments.positionTitle,
                grantedSystemRole: officerAppointments.grantedSystemRole,
                isCurrent: officerAppointments.isCurrent,
                appointedAt: officerAppointments.appointedAt,
                endedAt: officerAppointments.endedAt,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                userSystemRole: users.systemRole,
                accountStatus: users.accountStatus,
            })
            .from(officerAppointments)
            .innerJoin(users, eq(officerAppointments.userId, users.id))
            .where(eq(officerAppointments.academicTermId, termId))
            .orderBy(desc(officerAppointments.isCurrent), desc(officerAppointments.appointedAt));

        return apiJson({
            appointments: rows.map((row) => ({
                ...row,
                appointedAt: row.appointedAt.toISOString(),
                endedAt: row.endedAt ? row.endedAt.toISOString() : null,
            })),
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { id } = await context.params;
        const termId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = createAppointmentSchema.parse(body);

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

        const outcome = await db.transaction(async (tx) => {
            const [targetUser] = await tx
                .select({
                    id: users.id,
                    studentIdNumber: users.studentIdNumber,
                    fullName: users.fullName,
                    accountStatus: users.accountStatus,
                    systemRole: users.systemRole,
                })
                .from(users)
                .where(eq(users.id, input.userId))
                .limit(1);

            if (!targetUser) {
                return { kind: "user_not_found" as const };
            }
            if (targetUser.accountStatus !== "ACTIVE") {
                return { kind: "user_inactive" as const, status: targetUser.accountStatus };
            }

            const [created] = await tx
                .insert(officerAppointments)
                .values({
                    userId: targetUser.id,
                    academicTermId: term.id,
                    positionTitle: input.positionTitle,
                    grantedSystemRole: input.grantedSystemRole,
                    isCurrent: term.status !== "CLOSED",
                    appointedAt: now,
                    endedAt: term.status === "CLOSED" ? now : null,
                    appointedBy: actor.id,
                })
                .returning();

            let syncResult = null;
            if (term.status === "ACTIVE") {
                syncResult = await recomputeUserSystemRole(tx, targetUser.id, term.id, now);
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "OFFICER_APPOINTED",
                entityType: "officer_appointment",
                entityId: created.id,
                afterState: {
                    userId: targetUser.id,
                    academicTermId: term.id,
                    positionTitle: created.positionTitle,
                    grantedSystemRole: created.grantedSystemRole,
                    syncedSystemRole: syncResult?.nextRole ?? targetUser.systemRole,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return {
                kind: "ok" as const,
                appointment: created,
                targetUser,
                syncedSystemRole: syncResult?.nextRole ?? targetUser.systemRole,
            };
        });

        if (outcome.kind === "user_not_found") {
            return apiError(404, "USER_NOT_FOUND", "Target user not found.");
        }
        if (outcome.kind === "user_inactive") {
            return apiError(
                400,
                "USER_NOT_ACTIVE",
                `Cannot appoint an inactive user (status: ${outcome.status}).`,
            );
        }

        return apiJson(
            {
                appointment: {
                    id: outcome.appointment.id,
                    userId: outcome.appointment.userId,
                    academicTermId: outcome.appointment.academicTermId,
                    positionTitle: outcome.appointment.positionTitle,
                    grantedSystemRole: outcome.appointment.grantedSystemRole,
                    isCurrent: outcome.appointment.isCurrent,
                    appointedAt: outcome.appointment.appointedAt.toISOString(),
                    endedAt: outcome.appointment.endedAt?.toISOString() ?? null,
                    studentIdNumber: outcome.targetUser.studentIdNumber,
                    fullName: outcome.targetUser.fullName,
                    userSystemRole: outcome.syncedSystemRole,
                },
            },
            201,
        );
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            return apiError(
                409,
                "APPOINTMENT_CONFLICT",
                "User already holds that active position title in this term.",
            );
        }
        return apiErrorResponse(error);
    }
}
