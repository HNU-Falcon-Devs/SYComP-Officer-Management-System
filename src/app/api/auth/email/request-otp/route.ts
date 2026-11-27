import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { issueVerificationOtp, normalizeUniversityEmail } from "@/lib/auth/otp";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getServerSession,
} from "@/lib/auth/server";
import { createEmailProvider } from "@/lib/email/adapter";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const requestOtpSchema = z.object({
    email: z.string().trim().min(1, "University email is required.").max(255),
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
        const input = requestOtpSchema.parse(body);

        const env = getEnv();
        const normalizedEmail = normalizeUniversityEmail(input.email, env.UNIVERSITY_EMAIL_DOMAIN);
        if (!normalizedEmail) {
            return apiError(
                400,
                "INVALID_EMAIL_DOMAIN",
                `Please use your official @${env.UNIVERSITY_EMAIL_DOMAIN} university email.`,
            );
        }

        const [existingOwner] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.universityEmail, normalizedEmail), ne(users.id, actor.id)))
            .limit(1);

        if (existingOwner) {
            return apiError(
                409,
                "EMAIL_ALREADY_IN_USE",
                "That university email is already bound to another account.",
            );
        }

        const now = new Date();
        const shortLimit = await consumeRateLimit(db, {
            key: `otp:15m:user:${actor.id}`,
            limit: 3,
            windowMs: 15 * 60 * 1000,
            now,
        });
        const hourLimit = await consumeRateLimit(db, {
            key: `otp:1h:user:${actor.id}`,
            limit: 10,
            windowMs: 60 * 60 * 1000,
            now,
        });

        if (!shortLimit.allowed || !hourLimit.allowed) {
            return apiError(
                429,
                "RATE_LIMITED",
                "Too many verification code requests. Please wait before requesting another code.",
            );
        }

        const issued = await issueVerificationOtp(db, {
            userId: actor.id,
            purpose: "EMAIL_VERIFICATION",
            targetEmail: normalizedEmail,
            universityDomain: env.UNIVERSITY_EMAIL_DOMAIN,
            hmacSecret: env.OTP_HMAC_SECRET,
            now,
        });

        await createEmailProvider(env).send({
            to: issued.targetEmail,
            subject: "SYComP OMS — University Email Verification Code",
            text: `Your SYComP OMS verification code is ${issued.code}. It expires in 10 minutes.`,
            html: `<p>Your SYComP OMS university email verification code is <strong>${issued.code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
        });

        return apiJson({
            targetEmail: issued.targetEmail,
            expiresAt: issued.expiresAt.toISOString(),
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
