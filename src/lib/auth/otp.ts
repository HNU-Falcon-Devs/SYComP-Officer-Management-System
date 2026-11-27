import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import { verificationTokens } from "@/db/schema";

export type OtpPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export function normalizeUniversityEmail(email: string, universityDomain: string): string | null {
    const trimmed = email.trim().toLowerCase();
    const parts = trimmed.split("@");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
    }

    const normalizedDomain = universityDomain.trim().toLowerCase();
    if (parts[1] !== normalizedDomain) {
        return null;
    }

    return trimmed;
}

export function generateOtpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(code: string, secret: string): string {
    return createHmac("sha256", secret).update(code.trim()).digest("hex");
}

export function verifyOtpHash(code: string, storedHash: string, secret: string): boolean {
    if (!/^[0-9a-f]+$/i.test(storedHash)) {
        return false;
    }
    const candidate = Buffer.from(hashOtpCode(code, secret), "hex");
    const expected = Buffer.from(storedHash, "hex");
    if (candidate.length !== expected.length) {
        return false;
    }
    return timingSafeEqual(candidate, expected);
}

export interface IssueOtpInput {
    userId: string;
    purpose: OtpPurpose;
    targetEmail: string;
    universityDomain: string;
    hmacSecret: string;
    now?: Date;
}

export async function issueVerificationOtp(executor: DbExecutor, input: IssueOtpInput) {
    const normalizedEmail = normalizeUniversityEmail(input.targetEmail, input.universityDomain);
    if (!normalizedEmail) {
        throw new Error(`Email must belong to @${input.universityDomain}.`);
    }

    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const code = generateOtpCode();
    const tokenHash = hashOtpCode(code, input.hmacSecret);

    // Invalidate all prior unconsumed OTPs for (user_id, purpose)
    await executor
        .update(verificationTokens)
        .set({ consumedAt: now, updatedAt: now })
        .where(
            and(
                eq(verificationTokens.userId, input.userId),
                eq(verificationTokens.purpose, input.purpose),
                isNull(verificationTokens.consumedAt),
            ),
        );

    const [created] = await executor
        .insert(verificationTokens)
        .values({
            userId: input.userId,
            purpose: input.purpose,
            targetEmail: normalizedEmail,
            tokenHash,
            attemptCount: 0,
            expiresAt,
            createdAt: now,
            updatedAt: now,
        })
        .returning({
            id: verificationTokens.id,
            expiresAt: verificationTokens.expiresAt,
            targetEmail: verificationTokens.targetEmail,
        });

    return {
        tokenId: created.id,
        code,
        targetEmail: created.targetEmail,
        expiresAt: created.expiresAt,
    };
}

export type ConsumeOtpResult =
    | { ok: true; tokenId: string; targetEmail: string }
    | { ok: false; reason: "INVALID_OR_EXPIRED" | "INVALID_CODE" | "MAX_ATTEMPTS" };

export async function consumeVerificationOtp(
    executor: DbExecutor,
    input: {
        userId: string;
        purpose: OtpPurpose;
        targetEmail: string;
        code: string;
        universityDomain: string;
        hmacSecret: string;
        now?: Date;
    },
): Promise<ConsumeOtpResult> {
    const normalizedEmail = normalizeUniversityEmail(input.targetEmail, input.universityDomain);
    if (!normalizedEmail) {
        return { ok: false, reason: "INVALID_OR_EXPIRED" };
    }

    const now = input.now ?? new Date();

    const [latest] = await executor
        .select()
        .from(verificationTokens)
        .where(
            and(
                eq(verificationTokens.userId, input.userId),
                eq(verificationTokens.purpose, input.purpose),
                eq(verificationTokens.targetEmail, normalizedEmail),
                isNull(verificationTokens.consumedAt),
                gt(verificationTokens.expiresAt, now),
            ),
        )
        .orderBy(desc(verificationTokens.createdAt))
        .limit(1);

    if (!latest) {
        return { ok: false, reason: "INVALID_OR_EXPIRED" };
    }

    if (latest.attemptCount >= OTP_MAX_ATTEMPTS) {
        return { ok: false, reason: "MAX_ATTEMPTS" };
    }

    // Increment attempt_count atomically before comparing hash
    const [incremented] = await executor
        .update(verificationTokens)
        .set({
            attemptCount: sql`${verificationTokens.attemptCount} + 1`,
            updatedAt: now,
        })
        .where(
            and(
                eq(verificationTokens.id, latest.id),
                isNull(verificationTokens.consumedAt),
                sql`${verificationTokens.attemptCount} < ${OTP_MAX_ATTEMPTS}`,
            ),
        )
        .returning({
            id: verificationTokens.id,
            attemptCount: verificationTokens.attemptCount,
            tokenHash: verificationTokens.tokenHash,
            targetEmail: verificationTokens.targetEmail,
        });

    if (!incremented) {
        return { ok: false, reason: "MAX_ATTEMPTS" };
    }

    if (!verifyOtpHash(input.code, incremented.tokenHash, input.hmacSecret)) {
        if (incremented.attemptCount >= OTP_MAX_ATTEMPTS) {
            await executor
                .update(verificationTokens)
                .set({ consumedAt: now, updatedAt: now })
                .where(and(eq(verificationTokens.id, incremented.id), isNull(verificationTokens.consumedAt)));
            return { ok: false, reason: "MAX_ATTEMPTS" };
        }
        return { ok: false, reason: "INVALID_CODE" };
    }

    const [consumed] = await executor
        .update(verificationTokens)
        .set({ consumedAt: now, updatedAt: now })
        .where(and(eq(verificationTokens.id, incremented.id), isNull(verificationTokens.consumedAt)))
        .returning({
            id: verificationTokens.id,
            targetEmail: verificationTokens.targetEmail,
        });

    if (!consumed) {
        return { ok: false, reason: "INVALID_OR_EXPIRED" };
    }

    return { ok: true, tokenId: consumed.id, targetEmail: consumed.targetEmail };
}
