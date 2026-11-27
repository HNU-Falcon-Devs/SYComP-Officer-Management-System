import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/config/permissions";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { toSafeUserDto } from "@/lib/auth/dto";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import { revokeAllUserSessions } from "@/lib/auth/session";

const uuidSchema = z.string().uuid("Invalid user ID.");

const statusUpdateSchema = z.object({
    accountStatus: z.enum(ACCOUNT_STATUSES),
    reason: z.string().trim().min(5, "A reason of at least 5 characters is required.").max(500),
    statusReason: z.string().trim().max(100).optional(),
});

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
            "user:status:update",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const targetUserId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = statusUpdateSchema.parse(body);

        const now = new Date();
        const ip = getClientIp(request);

        const result = await db.transaction(async (tx) => {
            const [target] = await tx
                .select()
                .from(users)
                .where(eq(users.id, targetUserId))
                .limit(1);

            if (!target) {
                return { kind: "not_found" as const };
            }

            // Guard last active SUPER_ADMIN against any transition away from ACTIVE (DISABLED or NEEDS_REVIEW)
            if (
                target.systemRole === "SUPER_ADMIN" &&
                target.accountStatus === "ACTIVE" &&
                input.accountStatus !== "ACTIVE"
            ) {
                const [{ activeSuperAdmins }] = await tx
                    .select({ activeSuperAdmins: count() })
                    .from(users)
                    .where(
                        and(
                            eq(users.systemRole, "SUPER_ADMIN"),
                            eq(users.accountStatus, "ACTIVE"),
                        ),
                    );

                if (activeSuperAdmins <= 1) {
                    return { kind: "last_super_admin" as const };
                }
            }

            const statusReasonValue =
                input.accountStatus === "ACTIVE"
                    ? null
                    : (input.statusReason?.trim() || input.reason.slice(0, 100));

            const [updated] = await tx
                .update(users)
                .set({
                    accountStatus: input.accountStatus,
                    statusReason: statusReasonValue,
                    disabledAt: input.accountStatus === "DISABLED" ? now : null,
                    disabledBy: input.accountStatus === "DISABLED" ? actor.id : null,
                    updatedAt: now,
                })
                .where(eq(users.id, target.id))
                .returning();

            if (input.accountStatus !== "ACTIVE") {
                await revokeAllUserSessions(tx, target.id, now);
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action:
                    input.accountStatus === "DISABLED" ? "USER_DISABLED" : "USER_STATUS_CHANGED",
                entityType: "user",
                entityId: target.id,
                beforeState: {
                    accountStatus: target.accountStatus,
                    statusReason: target.statusReason,
                },
                afterState: {
                    accountStatus: updated.accountStatus,
                    statusReason: updated.statusReason,
                },
                reason: input.reason,
                ipAddress: ip,
            });

            return { kind: "ok" as const, user: updated };
        });

        if (result.kind === "not_found") {
            return apiError(404, "USER_NOT_FOUND", "Target user not found.");
        }
        if (result.kind === "last_super_admin") {
            return apiError(
                409,
                "LAST_SUPER_ADMIN",
                "Cannot disable or flag the last active Super Admin account.",
            );
        }

        return apiJson({ user: toSafeUserDto(result.user) });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
