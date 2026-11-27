import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import { users, userSessions } from "@/db/schema";

export const SESSION_COOKIE_NAME = "sycomp_session";
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_PRIVILEGED_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_STANDARD_MS = 24 * 60 * 60 * 1000;

export function getIdleTimeoutMs(role: SystemRole): number {
    return role === "SUPER_ADMIN" || role === "EXECUTIVE"
        ? SESSION_IDLE_TIMEOUT_PRIVILEGED_MS
        : SESSION_IDLE_TIMEOUT_STANDARD_MS;
}

export function hashSessionToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function buildSessionCookieOptions(expiresAt: Date, isProduction = process.env.NODE_ENV === "production") {
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax" as const,
        path: "/",
        expires: expiresAt,
    };
}

export interface CreateSessionInput {
    userId: string;
    roleTierSnapshot: SystemRole;
    ipAddress?: string | null;
    userAgent?: string | null;
    now?: Date;
}

export async function createSession(executor: DbExecutor, input: CreateSessionInput) {
    const now = input.now ?? new Date();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);

    const [created] = await executor
        .insert(userSessions)
        .values({
            userId: input.userId,
            tokenHash,
            roleTierSnapshot: input.roleTierSnapshot,
            expiresAt,
            lastActiveAt: now,
            ipAddress: input.ipAddress?.slice(0, 45) ?? null,
            userAgent: input.userAgent?.slice(0, 255) ?? null,
            createdAt: now,
        })
        .returning({
            id: userSessions.id,
            expiresAt: userSessions.expiresAt,
        });

    return {
        sessionId: created.id,
        token,
        expiresAt: created.expiresAt,
    };
}

export async function revokeSessionByToken(
    executor: DbExecutor,
    token: string,
    now = new Date(),
): Promise<void> {
    const tokenHash = hashSessionToken(token);
    await executor
        .update(userSessions)
        .set({ revokedAt: now })
        .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
}

export async function revokeAllUserSessions(
    executor: DbExecutor,
    userId: string,
    now = new Date(),
): Promise<void> {
    await executor
        .update(userSessions)
        .set({ revokedAt: now })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
}

export interface ActiveSessionContext {
    sessionId: string;
    user: typeof users.$inferSelect;
}

export async function getSessionFromToken(
    executor: DbExecutor,
    token: string | undefined | null,
    options?: { now?: Date; touchActivity?: boolean },
): Promise<ActiveSessionContext | null> {
    if (!token || token.trim().length === 0) {
        return null;
    }

    const now = options?.now ?? new Date();
    const tokenHash = hashSessionToken(token);

    const [row] = await executor
        .select({
            session: userSessions,
            user: users,
        })
        .from(userSessions)
        .innerJoin(users, eq(userSessions.userId, users.id))
        .where(
            and(
                eq(userSessions.tokenHash, tokenHash),
                isNull(userSessions.revokedAt),
                gt(userSessions.expiresAt, now),
            ),
        )
        .limit(1);

    if (!row) {
        return null;
    }

    const idleLimitMs = Math.min(
        getIdleTimeoutMs(row.user.systemRole),
        getIdleTimeoutMs(row.session.roleTierSnapshot),
    );
    if (now.getTime() - row.session.lastActiveAt.getTime() > idleLimitMs) {
        await executor
            .update(userSessions)
            .set({ revokedAt: now })
            .where(and(eq(userSessions.id, row.session.id), isNull(userSessions.revokedAt)));
        return null;
    }

    if (options?.touchActivity !== false && now.getTime() - row.session.lastActiveAt.getTime() > 60_000) {
        await executor
            .update(userSessions)
            .set({ lastActiveAt: now })
            .where(eq(userSessions.id, row.session.id));
    }

    return {
        sessionId: row.session.id,
        user: row.user,
    };
}
