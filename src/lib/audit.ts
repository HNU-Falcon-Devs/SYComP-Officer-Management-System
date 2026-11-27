import type { DbExecutor } from "@/db";
import { auditLogs } from "@/db/schema";

const SENSITIVE_KEY_PATTERN = /password|token|secret|hash|cookie/i;

function sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }
    if (typeof value === "object") {
        const clean: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                continue;
            }
            clean[key] = sanitizeValue(val);
        }
        return clean;
    }
    return value;
}

export function redactAuditState(
    state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!state) {
        return null;
    }
    return sanitizeValue(state) as Record<string, unknown>;
}

export interface WriteAuditLogInput {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
    ipAddress?: string | null;
    breakGlass?: boolean;
}

export async function writeAuditLog(executor: DbExecutor, entry: WriteAuditLogInput) {
    const trimmedReason = entry.reason?.trim() || null;

    if (entry.breakGlass && (!trimmedReason || trimmedReason.length < 10)) {
        throw new Error("Break-glass audit entries require a reason of at least 10 characters.");
    }

    const beforeState = redactAuditState(entry.beforeState);
    let afterState = redactAuditState(entry.afterState);

    if (entry.breakGlass) {
        afterState = {
            ...(afterState ?? {}),
            break_glass: true,
        };
    }

    const [inserted] = await executor
        .insert(auditLogs)
        .values({
            actorId: entry.actorId,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId,
            beforeState,
            afterState,
            reason: trimmedReason,
            ipAddress: entry.ipAddress ?? null,
        })
        .returning();

    return inserted;
}
