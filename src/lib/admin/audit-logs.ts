import { eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { SystemRole } from "@/config/permissions";
import { auditLogs, users } from "@/db/schema";
import { redactAuditState } from "@/lib/audit";

export const AUDIT_LOG_DEFAULT_LIMIT = 25;
export const AUDIT_LOG_MAX_LIMIT = 100;
export const AUDIT_LOG_EXPORT_LIMIT = 2000;

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const manilaFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

export function isValidCalendarDate(value: string): boolean {
    if (!CALENDAR_DATE_RE.test(value)) {
        return false;
    }
    const [yearStr, monthStr, dayStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const utc = new Date(Date.UTC(year, month - 1, day));
    return (
        utc.getUTCFullYear() === year &&
        utc.getUTCMonth() === month - 1 &&
        utc.getUTCDate() === day
    );
}

/** Start of an Asia/Manila calendar day (00:00:00+08:00) in UTC. */
export function manilaDayStartUtc(dateStr: string): Date {
    if (!isValidCalendarDate(dateStr)) {
        throw new Error(`Invalid calendar date: ${dateStr}`);
    }
    return new Date(`${dateStr}T00:00:00+08:00`);
}

/** Exclusive upper bound for an Asia/Manila calendar day (next day 00:00:00+08:00) in UTC. */
export function manilaNextDayStartUtc(dateStr: string): Date {
    return new Date(manilaDayStartUtc(dateStr).getTime() + 86_400_000);
}

export function formatManilaTimestamp(isoOrDate: string | Date): string {
    const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(date.getTime())) {
        return String(isoOrDate);
    }
    const parts = Object.fromEntries(
        manilaFormatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second} PHT`;
}

const auditLogsFilterShape = {
    q: z.string().trim().max(100).optional(),
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().uuid("Invalid entity ID.").optional(),
    actorId: z.string().uuid("Invalid actor ID.").optional(),
    breakGlassOnly: z
        .enum(["true", "false"])
        .optional()
        .transform((val) => val === "true"),
    from: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
    to: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
};

export const auditLogsFilterSchema = z
    .object(auditLogsFilterShape)
    .refine((data) => !data.from || !data.to || data.to >= data.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export const auditLogsListQuerySchema = z
    .object({
        ...auditLogsFilterShape,
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(AUDIT_LOG_MAX_LIMIT)
            .default(AUDIT_LOG_DEFAULT_LIMIT),
    })
    .refine((data) => !data.from || !data.to || data.to >= data.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export type AuditLogsFilter = z.infer<typeof auditLogsFilterSchema>;

export function parseAuditSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        q: getParam("q"),
        action: getParam("action"),
        entityType: getParam("entityType"),
        entityId: getParam("entityId"),
        actorId: getParam("actorId"),
        breakGlassOnly: getParam("breakGlassOnly"),
        from: getParam("from"),
        to: getParam("to"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

export function escapeLikePattern(input: string): string {
    return input.replace(/[\\%_]/g, "\\$&");
}

export function buildAuditLogConditions(filter: AuditLogsFilter): SQL[] {
    const conditions: SQL[] = [];

    if (filter.q) {
        const pattern = `%${escapeLikePattern(filter.q)}%`;
        const searchExpr = or(
            ilike(auditLogs.action, pattern),
            ilike(auditLogs.entityType, pattern),
            ilike(auditLogs.reason, pattern),
            sql`CAST(${auditLogs.entityId} AS TEXT) ILIKE ${pattern}`,
            ilike(users.studentIdNumber, pattern),
            ilike(users.fullName, pattern),
        );
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }

    if (filter.action) {
        conditions.push(eq(auditLogs.action, filter.action));
    }

    if (filter.entityType) {
        conditions.push(eq(auditLogs.entityType, filter.entityType));
    }

    if (filter.entityId) {
        conditions.push(eq(auditLogs.entityId, filter.entityId));
    }

    if (filter.actorId) {
        conditions.push(eq(auditLogs.actorId, filter.actorId));
    }

    if (filter.breakGlassOnly) {
        conditions.push(
            sql`jsonb_typeof(${auditLogs.afterState}) = 'object' AND (${auditLogs.afterState} ->> 'break_glass') = 'true'`,
        );
    }

    if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, manilaDayStartUtc(filter.from)));
    }

    if (filter.to) {
        conditions.push(lt(auditLogs.createdAt, manilaNextDayStartUtc(filter.to)));
    }

    return conditions;
}

export interface AuditLogActorDto {
    id: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
}

export interface AuditLogDto {
    id: string;
    createdAt: string;
    action: string;
    entityType: string;
    entityId: string;
    actor: AuditLogActorDto | null;
    reason: string | null;
    ipAddress: string | null;
    isBreakGlass: boolean;
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown> | null;
}

export interface RawAuditLogJoinRow {
    id: string;
    createdAt: Date;
    action: string;
    entityType: string;
    entityId: string;
    reason: string | null;
    ipAddress: string | null;
    beforeState: unknown;
    afterState: unknown;
    actorId: string | null;
    actorStudentIdNumber: string | null;
    actorFullName: string | null;
    actorSystemRole: SystemRole | null;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function toAuditLogDto(row: RawAuditLogJoinRow): AuditLogDto {
    const beforeState = redactAuditState(asRecordOrNull(row.beforeState));
    const afterState = redactAuditState(asRecordOrNull(row.afterState));
    const isBreakGlass = Boolean(afterState && afterState.break_glass === true);

    return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor:
            row.actorId && row.actorStudentIdNumber && row.actorFullName && row.actorSystemRole
                ? {
                      id: row.actorId,
                      studentIdNumber: row.actorStudentIdNumber,
                      fullName: row.actorFullName,
                      systemRole: row.actorSystemRole,
                  }
                : null,
        reason: row.reason,
        ipAddress: row.ipAddress,
        isBreakGlass,
        beforeState,
        afterState,
    };
}

export interface StateDiffEntry {
    key: string;
    kind: "added" | "removed" | "changed" | "unchanged";
    before: unknown;
    after: unknown;
}

export function computeStateDiff(
    beforeState: Record<string, unknown> | null,
    afterState: Record<string, unknown> | null,
): StateDiffEntry[] {
    const keys = new Set<string>([
        ...Object.keys(beforeState ?? {}),
        ...Object.keys(afterState ?? {}),
    ]);
    const sortedKeys = Array.from(keys).sort();

    return sortedKeys.map((key) => {
        const hasBefore = beforeState !== null && Object.hasOwn(beforeState, key);
        const hasAfter = afterState !== null && Object.hasOwn(afterState, key);
        const before = hasBefore ? beforeState[key] : undefined;
        const after = hasAfter ? afterState[key] : undefined;

        if (!hasBefore && hasAfter) {
            return { key, kind: "added", before: undefined, after };
        }
        if (hasBefore && !hasAfter) {
            return { key, kind: "removed", before, after: undefined };
        }
        const same = JSON.stringify(before) === JSON.stringify(after);
        return {
            key,
            kind: same ? "unchanged" : "changed",
            before,
            after,
        };
    });
}
