import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { issueVerificationOtp, normalizeUniversityEmail } from "@/lib/auth/otp";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
} from "@/lib/auth/server";
import { createEmailProvider } from "@/lib/email/adapter";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const resetRequestSchema = z.object({
    studentIdNumber: z.string().trim().min(1, "Student ID is required.").max(32),
    email: z.string().trim().min(1, "University email is required.").max(255),
});

const GENERIC_RESET_RESPONSE =
    "If an active account with a verified university email matches those details, a 6-digit verification code has been sent. Unverified accounts must contact SYComP administration for a reset.";

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const body = await request.json().catch(() => null);
        const input = resetRequestSchema.parse(body);

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
        const normalizedId = input.studentIdNumber.trim().toLowerCase();

        const ipLimit = await consumeRateLimit(db, {
            key: `reset:ip:${ip}`,
            limit: 10,
            windowMs: 15 * 60 * 1000,
            now,
        });
        const idShortLimit = await consumeRateLimit(db, {
            key: `reset:15m:id:${normalizedId}`,
            limit: 3,
            windowMs: 15 * 60 * 1000,
            now,
        });
        const idHourLimit = await consumeRateLimit(db, {
            key: `reset:1h:id:${normalizedId}`,
            limit: 10,
            windowMs: 60 * 60 * 1000,
            now,
        });

        if (!ipLimit.allowed || !idShortLimit.allowed || !idHourLimit.allowed) {
            return apiError(
                429,
                "RATE_LIMITED",
                "Too many password reset requests. Please wait before trying again.",
            );
        }

        const [user] = await db
            .select()
            .from(users)
            .where(
                and(
                    sql`lower(${users.studentIdNumber}) = ${normalizedId}`,
                    eq(users.universityEmail, normalizedEmail),
                    isNotNull(users.emailVerifiedAt),
                    eq(users.accountStatus, "ACTIVE"),
                ),
            )
            .limit(1);

        if (user) {
            const issued = await issueVerificationOtp(db, {
                userId: user.id,
                purpose: "PASSWORD_RESET",
                targetEmail: normalizedEmail,
                universityDomain: env.UNIVERSITY_EMAIL_DOMAIN,
                hmacSecret: env.OTP_HMAC_SECRET,
                now,
            });

            await createEmailProvider(env).send({
                to: issued.targetEmail,
                subject: "SYComP OMS — Password Reset Verification Code",
                text: `Your SYComP OMS password reset code is ${issued.code}. It expires in 10 minutes.`,
                html: `<p>Your SYComP OMS password reset code is <strong>${issued.code}</strong>.</p><p>This code expires in 10 minutes. If you did not request a reset, ignore this email.</p>`,
            });
        }

        return apiJson({ message: GENERIC_RESET_RESPONSE });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
