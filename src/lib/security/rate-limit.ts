import { lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import { rateLimitBuckets } from "@/db/schema";

export interface RateLimitInput {
    key: string;
    limit: number;
    windowMs: number;
    now?: Date;
}

export interface RateLimitResult {
    allowed: boolean;
    count: number;
    remaining: number;
    resetAt: Date;
}

export async function consumeRateLimit(
    executor: DbExecutor,
    input: RateLimitInput,
): Promise<RateLimitResult> {
    const now = input.now ?? new Date();
    const nextExpiry = new Date(now.getTime() + input.windowMs);
    const nowIso = now.toISOString();
    const nextExpiryIso = nextExpiry.toISOString();

    const [bucket] = await executor
        .insert(rateLimitBuckets)
        .values({
            key: input.key,
            count: 1,
            windowExpiresAt: nextExpiry,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: rateLimitBuckets.key,
            set: {
                count: sql`CASE WHEN ${rateLimitBuckets.windowExpiresAt} <= ${nowIso}::timestamptz THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
                windowExpiresAt: sql`CASE WHEN ${rateLimitBuckets.windowExpiresAt} <= ${nowIso}::timestamptz THEN ${nextExpiryIso}::timestamptz ELSE ${rateLimitBuckets.windowExpiresAt} END`,
                updatedAt: now,
            },
        })
        .returning({
            count: rateLimitBuckets.count,
            windowExpiresAt: rateLimitBuckets.windowExpiresAt,
        });

    const allowed = bucket.count <= input.limit;
    return {
        allowed,
        count: bucket.count,
        remaining: Math.max(0, input.limit - bucket.count),
        resetAt: bucket.windowExpiresAt,
    };
}

export async function pruneExpiredRateLimits(executor: DbExecutor, now = new Date()): Promise<void> {
    await executor.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowExpiresAt, now));
}
