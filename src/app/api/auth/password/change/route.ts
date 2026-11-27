import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { toSessionActorDto } from "@/lib/auth/dto";
import {
    hashPassword,
    validateUserPasswordPolicy,
    verifyPassword,
} from "@/lib/auth/password";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import {
    buildSessionCookieOptions,
    createSession,
    revokeAllUserSessions,
    SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required.").max(200),
    newPassword: z.string().min(1, "New password is required.").max(200),
});

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "account:self:update",
            { targetUserId: session?.user.id },
            createDrizzleAuthorizeDeps(db),
        );

        const body = await request.json().catch(() => null);
        const input = changePasswordSchema.parse(body);

        const currentUser = session!.user;
        const currentMatches = await verifyPassword(input.currentPassword, currentUser.passwordHash);
        if (!currentMatches) {
            return apiError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.");
        }

        const policy = validateUserPasswordPolicy(
            input.newPassword,
            currentUser.studentIdNumber,
            currentUser.lastName,
        );
        if (!policy.valid) {
            return apiError(400, "WEAK_PASSWORD", policy.error ?? "Password does not meet policy.");
        }

        const now = new Date();
        const ip = getClientIp(request);
        const userAgent = request.headers.get("user-agent")?.slice(0, 255) ?? null;
        const nextHash = await hashPassword(input.newPassword);

        const { updatedUser, freshSession } = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(users)
                .set({
                    passwordHash: nextHash,
                    mustChangePassword: false,
                    updatedAt: now,
                })
                .where(eq(users.id, actor.id))
                .returning();

            await revokeAllUserSessions(tx, actor.id, now);
            const nextSession = await createSession(tx, {
                userId: actor.id,
                roleTierSnapshot: updated.systemRole,
                ipAddress: ip,
                userAgent,
                now,
            });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "USER_PASSWORD_CHANGED",
                entityType: "user",
                entityId: actor.id,
                beforeState: { mustChangePassword: currentUser.mustChangePassword },
                afterState: { mustChangePassword: false },
                ipAddress: ip,
            });

            return { updatedUser: updated, freshSession: nextSession };
        });

        const response = apiJson({ user: toSessionActorDto(updatedUser) });
        response.cookies.set(
            SESSION_COOKIE_NAME,
            freshSession.token,
            buildSessionCookieOptions(freshSession.expiresAt),
        );

        return response;
    } catch (error) {
        return apiErrorResponse(error);
    }
}
