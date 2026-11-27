import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ROUTES } from "@/config/routes";
import { getDb } from "@/db";
import { rateLimitBuckets, users } from "@/db/schema";
import { toSessionActorDto } from "@/lib/auth/dto";
import { verifyPasswordOrDummy } from "@/lib/auth/password";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    resolvePostLoginRedirect,
} from "@/lib/auth/server";
import {
    buildSessionCookieOptions,
    createSession,
    revokeAllUserSessions,
    SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const loginSchema = z.object({
    studentIdNumber: z.string().trim().min(1, "Student ID is required.").max(32),
    password: z.string().min(1, "Password is required.").max(200),
    next: z.string().optional(),
});

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const body = await request.json().catch(() => null);
        const input = loginSchema.parse(body);

        const db = getDb();
        const now = new Date();
        const ip = getClientIp(request);
        const normalizedId = input.studentIdNumber.trim().toLowerCase();
        const idRateKey = `login:id:${normalizedId}`;

        const ipLimit = await consumeRateLimit(db, {
            key: `login:ip:${ip}`,
            limit: 10,
            windowMs: FIFTEEN_MINUTES_MS,
            now,
        });
        if (!ipLimit.allowed) {
            const retrySeconds = Math.max(
                1,
                Math.ceil((ipLimit.resetAt.getTime() - now.getTime()) / 1000),
            );
            return apiError(
                429,
                "RATE_LIMITED",
                "Too many login attempts from this network. Try again shortly.",
                undefined,
                { "Retry-After": String(retrySeconds) },
            );
        }

        const [idBucket] = await db
            .select()
            .from(rateLimitBuckets)
            .where(eq(rateLimitBuckets.key, idRateKey))
            .limit(1);

        if (idBucket && idBucket.count >= 5 && idBucket.windowExpiresAt > now) {
            const retrySeconds = Math.max(
                1,
                Math.ceil((idBucket.windowExpiresAt.getTime() - now.getTime()) / 1000),
            );
            return apiError(
                429,
                "LOGIN_COOLDOWN",
                "Too many failed attempts for this Student ID. Please wait 15 minutes.",
                undefined,
                { "Retry-After": String(retrySeconds) },
            );
        }

        const [user] = await db
            .select()
            .from(users)
            .where(sql`lower(${users.studentIdNumber}) = ${normalizedId}`)
            .limit(1);

        const passwordValid = await verifyPasswordOrDummy(input.password, user?.passwordHash);
        if (!user || !passwordValid) {
            await consumeRateLimit(db, {
                key: idRateKey,
                limit: 5,
                windowMs: FIFTEEN_MINUTES_MS,
                now,
            });
            return apiError(401, "INVALID_CREDENTIALS", "Invalid Student ID or password.");
        }

        if (user.accountStatus !== "ACTIVE") {
            await revokeAllUserSessions(db, user.id, now);
            return apiError(
                403,
                "ACCOUNT_HOLD",
                "Your account is currently on hold. Contact SYComP officers or administration.",
                {
                    accountStatus: user.accountStatus,
                    redirectTo: ROUTES.auth.accountHold,
                },
            );
        }

        const userAgent = request.headers.get("user-agent")?.slice(0, 255) ?? null;

        const session = await db.transaction(async (tx) => {
            await tx.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, idRateKey));
            await tx
                .update(users)
                .set({ lastLoginAt: now, updatedAt: now })
                .where(eq(users.id, user.id));

            return createSession(tx, {
                userId: user.id,
                roleTierSnapshot: user.systemRole,
                ipAddress: ip,
                userAgent,
                now,
            });
        });

        const redirectTo = resolvePostLoginRedirect(user.systemRole, input.next);
        const response = apiJson({
            user: toSessionActorDto({ ...user, lastLoginAt: now }),
            redirectTo,
        });

        response.cookies.set(
            SESSION_COOKIE_NAME,
            session.token,
            buildSessionCookieOptions(session.expiresAt),
        );

        return response;
    } catch (error) {
        return apiErrorResponse(error);
    }
}
