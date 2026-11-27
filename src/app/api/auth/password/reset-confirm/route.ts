import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { consumeVerificationOtp, normalizeUniversityEmail } from "@/lib/auth/otp";
import { hashPassword, validateUserPasswordPolicy } from "@/lib/auth/password";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
} from "@/lib/auth/server";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const resetConfirmSchema = z.object({
    studentIdNumber: z.string().trim().min(1, "Student ID is required.").max(32),
    email: z.string().trim().min(1, "University email is required.").max(255),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Verification code must be a 6-digit number."),
    newPassword: z.string().min(1, "New password is required.").max(200),
});

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const body = await request.json().catch(() => null);
        const input = resetConfirmSchema.parse(body);

        const env = getEnv();
        const normalizedEmail = normalizeUniversityEmail(input.email, env.UNIVERSITY_EMAIL_DOMAIN);
        if (!normalizedEmail) {
            return apiError(
                400,
                "INVALID_EMAIL_DOMAIN",
                `Please use your official @${env.UNIVERSITY_EMAIL_DOMAIN} university email.`,
            );
        }

        const db = getDb();
        const now = new Date();
        const ip = getClientIp(request);

        const ipLimit = await consumeRateLimit(db, {
            key: `reset:confirm:ip:${ip}`,
            limit: 10,
            windowMs: 15 * 60 * 1000,
            now,
        });
        if (!ipLimit.allowed) {
            return apiError(
                429,
                "RATE_LIMITED",
                "Too many password reset attempts. Please wait before trying again.",
            );
        }

        const normalizedId = input.studentIdNumber.trim().toLowerCase();
        const [user] = await db
            .select()
            .from(users)
            .where(
                and(
                    sql`lower(${users.studentIdNumber}) = ${normalizedId}`,
                    eq(users.universityEmail, normalizedEmail),
                    isNotNull(users.emailVerifiedAt),
                ),
            )
            .limit(1);

        if (!user || user.accountStatus !== "ACTIVE") {
            return apiError(400, "OTP_INVALID", "Invalid or expired password reset request.");
        }

        const policy = validateUserPasswordPolicy(
            input.newPassword,
            user.studentIdNumber,
            user.lastName,
        );
        if (!policy.valid) {
            return apiError(400, "WEAK_PASSWORD", policy.error ?? "Password does not meet policy.");
        }

        const nextHash = await hashPassword(input.newPassword);

        const outcome = await db.transaction(async (tx) => {
            // Re-verify active lifecycle status inside transaction at confirm time
            const [freshUser] = await tx
                .select()
                .from(users)
                .where(eq(users.id, user.id))
                .limit(1);

            if (
                !freshUser ||
                freshUser.accountStatus !== "ACTIVE" ||
                !freshUser.emailVerifiedAt
            ) {
                return { status: "inactive" as const };
            }

            const otpResult = await consumeVerificationOtp(tx, {
                userId: freshUser.id,
                purpose: "PASSWORD_RESET",
                targetEmail: normalizedEmail,
                code: input.code,
                universityDomain: env.UNIVERSITY_EMAIL_DOMAIN,
                hmacSecret: env.OTP_HMAC_SECRET,
                now,
            });

            if (!otpResult.ok) {
                return { status: "otp_error" as const, reason: otpResult.reason };
            }

            await tx
                .update(users)
                .set({
                    passwordHash: nextHash,
                    mustChangePassword: false,
                    updatedAt: now,
                })
                .where(eq(users.id, freshUser.id));

            await revokeAllUserSessions(tx, freshUser.id, now);

            await writeAuditLog(tx, {
                actorId: freshUser.id,
                action: "USER_PASSWORD_RESET",
                entityType: "user",
                entityId: freshUser.id,
                beforeState: { mustChangePassword: freshUser.mustChangePassword },
                afterState: { mustChangePassword: false },
                ipAddress: ip,
            });

            return { status: "ok" as const };
        });

        if (outcome.status === "inactive") {
            return apiError(403, "ACCOUNT_HOLD", "Account is not active. Contact SYComP administration.");
        }

        if (outcome.status === "otp_error") {
            if (outcome.reason === "MAX_ATTEMPTS") {
                return apiError(
                    429,
                    "OTP_LOCKED",
                    "Maximum verification attempts reached. Request a new password reset code.",
                );
            }
            return apiError(400, "OTP_INVALID", "Invalid or expired verification code.");
        }

        return apiJson({ reset: true });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
