import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { toSessionActorDto } from "@/lib/auth/dto";
import { consumeVerificationOtp, normalizeUniversityEmail } from "@/lib/auth/otp";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";

const verifyOtpSchema = z.object({
    email: z.string().trim().min(1).max(255),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Verification code must be a 6-digit number."),
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
        const input = verifyOtpSchema.parse(body);

        const env = getEnv();
        const normalizedEmail = normalizeUniversityEmail(input.email, env.UNIVERSITY_EMAIL_DOMAIN);
        if (!normalizedEmail) {
            return apiError(
                400,
                "INVALID_EMAIL_DOMAIN",
                `Please use your official @${env.UNIVERSITY_EMAIL_DOMAIN} university email.`,
            );
        }

        const now = new Date();
        const ip = getClientIp(request);

        const outcome = await db.transaction(async (tx) => {
            const [existingOwner] = await tx
                .select({ id: users.id })
                .from(users)
                .where(and(eq(users.universityEmail, normalizedEmail), ne(users.id, actor.id)))
                .limit(1);

            if (existingOwner) {
                return { status: "conflict" as const };
            }

            const result = await consumeVerificationOtp(tx, {
                userId: actor.id,
                purpose: "EMAIL_VERIFICATION",
                targetEmail: normalizedEmail,
                code: input.code,
                universityDomain: env.UNIVERSITY_EMAIL_DOMAIN,
                hmacSecret: env.OTP_HMAC_SECRET,
                now,
            });

            if (!result.ok) {
                return { status: "otp_error" as const, reason: result.reason };
            }

            const [updated] = await tx
                .update(users)
                .set({
                    universityEmail: result.targetEmail,
                    emailVerifiedAt: now,
                    updatedAt: now,
                })
                .where(eq(users.id, actor.id))
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "USER_EMAIL_VERIFIED",
                entityType: "user",
                entityId: actor.id,
                beforeState: {
                    universityEmail: session!.user.universityEmail,
                    emailVerifiedAt: session!.user.emailVerifiedAt,
                },
                afterState: {
                    universityEmail: updated.universityEmail,
                    emailVerifiedAt: updated.emailVerifiedAt,
                },
                ipAddress: ip,
            });

            return { status: "ok" as const, user: updated };
        });

        if (outcome.status === "conflict") {
            return apiError(
                409,
                "EMAIL_ALREADY_IN_USE",
                "That university email is already bound to another account.",
            );
        }

        if (outcome.status === "otp_error") {
            if (outcome.reason === "MAX_ATTEMPTS") {
                return apiError(
                    429,
                    "OTP_LOCKED",
                    "Maximum verification attempts reached. Request a new 6-digit code.",
                );
            }
            return apiError(400, "OTP_INVALID", "Invalid or expired verification code.");
        }

        return apiJson({ user: toSessionActorDto(outcome.user) });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
