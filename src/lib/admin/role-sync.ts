import "server-only";
import { and, count, eq } from "drizzle-orm";
import type { SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import { officerAppointments, users } from "@/db/schema";
import { AuthorizationError } from "@/lib/auth/authorize";
import { revokeAllUserSessions } from "@/lib/auth/session";

const ROLE_RANK: Record<SystemRole, number> = {
    MEMBER: 0,
    OFFICER: 1,
    EXECUTIVE: 2,
    SUPER_ADMIN: 3,
};

export interface RoleSyncResult {
    userId: string;
    previousRole: SystemRole;
    nextRole: SystemRole;
    downgraded: boolean;
    sessionsRevoked: boolean;
}

export async function recomputeUserSystemRole(
    tx: DbExecutor,
    userId: string,
    activeTermId: string | null,
    now = new Date(),
): Promise<RoleSyncResult | null> {
    const [user] = await tx
        .select({
            id: users.id,
            systemRole: users.systemRole,
            accountStatus: users.accountStatus,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        return null;
    }

    const activeTermAppointments = activeTermId
        ? await tx
              .select({ grantedSystemRole: officerAppointments.grantedSystemRole })
              .from(officerAppointments)
              .where(
                  and(
                      eq(officerAppointments.userId, userId),
                      eq(officerAppointments.academicTermId, activeTermId),
                      eq(officerAppointments.isCurrent, true),
                  ),
              )
        : [];

    let nextRole: SystemRole = "MEMBER";
    for (const appt of activeTermAppointments) {
        if (ROLE_RANK[appt.grantedSystemRole] > ROLE_RANK[nextRole]) {
            nextRole = appt.grantedSystemRole;
        }
    }

    // Preserve standing non-term SUPER_ADMIN custody accounts (docs/03 Sec 6.3)
    if (user.systemRole === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN") {
        const [{ totalSuperAdminAppts }] = await tx
            .select({ totalSuperAdminAppts: count() })
            .from(officerAppointments)
            .where(
                and(
                    eq(officerAppointments.userId, userId),
                    eq(officerAppointments.grantedSystemRole, "SUPER_ADMIN"),
                ),
            );

        if (totalSuperAdminAppts === 0) {
            nextRole = "SUPER_ADMIN";
        } else if (user.accountStatus === "ACTIVE") {
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
                throw new AuthorizationError(
                    409,
                    "LAST_SUPER_ADMIN",
                    "Cannot downgrade the last active Super Admin account.",
                );
            }
        }
    }

    const downgraded = ROLE_RANK[nextRole] < ROLE_RANK[user.systemRole];

    if (nextRole !== user.systemRole) {
        await tx
            .update(users)
            .set({ systemRole: nextRole, updatedAt: now })
            .where(eq(users.id, userId));
    }

    if (downgraded) {
        await revokeAllUserSessions(tx, userId, now);
    }

    return {
        userId,
        previousRole: user.systemRole,
        nextRole,
        downgraded,
        sessionsRevoked: downgraded,
    };
}
