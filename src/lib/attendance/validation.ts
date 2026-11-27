import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AccountStatus, SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import {
    academicTerms,
    attendanceCheckpoints,
    attendanceRecords,
    events,
    meetings,
    officerAppointments,
    users,
} from "@/db/schema";
import {
    escapeLikePattern,
    isValidCalendarDate,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
} from "@/lib/admin/audit-logs";

export const ATTENDANCE_DEFAULT_LIMIT = 25;
export const ATTENDANCE_MAX_LIMIT = 100;
export const ATTENDANCE_EXPORT_LIMIT = 2000;
export const STUDENT_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/;

export const CHECKPOINT_AUDIENCE_SCOPES = ["GENERAL_MEMBERS", "OFFICERS_ONLY", "ALL"] as const;
export type CheckpointAudienceScope = (typeof CHECKPOINT_AUDIENCE_SCOPES)[number];

export const CHECKPOINT_STATUSES = ["SCHEDULED", "OPEN", "CLOSED"] as const;
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_RECORDED_VIA = ["QR_SCAN", "MANUAL_EXECUTIVE"] as const;
export type AttendanceRecordedVia = (typeof ATTENDANCE_RECORDED_VIA)[number];

export const studentIdNumberSchema = z
    .string()
    .trim()
    .regex(STUDENT_ID_REGEX, "Invalid Student ID format.");

const optionalIsoDateTime = z.preprocess(
    (val) => (val === "" ? null : val),
    z.iso.datetime({ offset: true }).nullable().optional(),
);

export const createCheckpointSchema = z
    .object({
        eventId: z.string().uuid("Invalid event ID.").optional(),
        meetingId: z.string().uuid("Invalid meeting ID.").optional(),
        label: z
            .string()
            .trim()
            .min(2, "Checkpoint label must be at least 2 characters.")
            .max(100, "Checkpoint label must be at most 100 characters."),
        audienceScope: z.enum(CHECKPOINT_AUDIENCE_SCOPES).optional(),
        sortOrder: z.coerce.number().int().min(1).max(100).default(1),
        opensAt: optionalIsoDateTime,
        closesAt: optionalIsoDateTime,
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .refine((d) => Boolean(d.eventId) !== Boolean(d.meetingId), {
        message: "Provide exactly one of eventId or meetingId.",
    })
    .refine(
        (d) =>
            !d.opensAt ||
            !d.closesAt ||
            new Date(d.closesAt).getTime() >= new Date(d.opensAt).getTime(),
        {
            message: "Closing time must be on or after opening time.",
            path: ["closesAt"],
        },
    );

export const updateCheckpointSchema = z
    .object({
        label: z
            .string()
            .trim()
            .min(2, "Checkpoint label must be at least 2 characters.")
            .max(100, "Checkpoint label must be at most 100 characters.")
            .optional(),
        audienceScope: z.enum(CHECKPOINT_AUDIENCE_SCOPES).optional(),
        sortOrder: z.coerce.number().int().min(1).max(100).optional(),
        opensAt: optionalIsoDateTime,
        closesAt: optionalIsoDateTime,
        status: z.enum(CHECKPOINT_STATUSES).optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (d) =>
            d.label !== undefined ||
            d.audienceScope !== undefined ||
            d.sortOrder !== undefined ||
            d.opensAt !== undefined ||
            d.closesAt !== undefined ||
            d.status !== undefined,
        {
            message: "Provide at least one checkpoint field to update.",
        },
    );

export const lookupQuerySchema = z.object({
    checkpointId: z.string().uuid("Invalid checkpoint ID."),
    studentId: studentIdNumberSchema,
});

export const confirmScanSchema = z.object({
    checkpointId: z.string().uuid("Invalid checkpoint ID."),
    studentIdNumber: studentIdNumberSchema,
    breakGlass: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
});

export const manualOverrideCreateSchema = z.object({
    checkpointId: z.string().uuid("Invalid checkpoint ID."),
    studentIdNumber: studentIdNumberSchema,
    status: z.enum(ATTENDANCE_STATUSES),
    editReason: z
        .string()
        .trim()
        .min(5, "Edit reason must be at least 5 characters.")
        .max(500),
    breakGlass: z.boolean().optional(),
});

export const manualOverridePatchSchema = z.object({
    recordId: z.string().uuid("Invalid attendance record ID."),
    status: z.enum(ATTENDANCE_STATUSES),
    editReason: z
        .string()
        .trim()
        .min(5, "Edit reason must be at least 5 characters.")
        .max(500),
    breakGlass: z.boolean().optional(),
});

const attendanceRecordsFilterShape = {
    eventId: z.string().uuid("Invalid event ID.").optional(),
    meetingId: z.string().uuid("Invalid meeting ID.").optional(),
    checkpointId: z.string().uuid("Invalid checkpoint ID.").optional(),
    status: z.enum(ATTENDANCE_STATUSES).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
    to: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
};

export const attendanceRecordsFilterSchema = z
    .object(attendanceRecordsFilterShape)
    .refine((d) => Boolean(d.eventId || d.meetingId || d.checkpointId), {
        message: "Provide eventId, meetingId, or checkpointId.",
    })
    .refine((d) => !d.from || !d.to || d.to >= d.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export const attendanceRecordsListQuerySchema = z
    .object({
        ...attendanceRecordsFilterShape,
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(ATTENDANCE_MAX_LIMIT)
            .default(ATTENDANCE_DEFAULT_LIMIT),
    })
    .refine((d) => Boolean(d.eventId || d.meetingId || d.checkpointId), {
        message: "Provide eventId, meetingId, or checkpointId.",
    })
    .refine((d) => !d.from || !d.to || d.to >= d.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export type AttendanceRecordsFilter = z.infer<typeof attendanceRecordsFilterSchema>;

export function parseAttendanceSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        eventId: getParam("eventId"),
        meetingId: getParam("meetingId"),
        checkpointId: getParam("checkpointId"),
        status: getParam("status"),
        q: getParam("q"),
        from: getParam("from"),
        to: getParam("to"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

export interface CheckpointParentContext {
    kind: "EVENT" | "MEETING";
    parentId: string;
    parentTitle: string;
    academicTermId: string;
    termCode: string;
    termName: string;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    eventStatus?:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "NEEDS_REVISION"
        | "REJECTED"
        | "APPROVED"
        | "PUBLISHED"
        | "COMPLETED";
    meetingStatus?: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
}

export interface CheckpointContext {
    checkpoint: typeof attendanceCheckpoints.$inferSelect;
    term: {
        id: string;
        code: string;
        name: string;
        status: "DRAFT" | "ACTIVE" | "CLOSED";
    };
    event: {
        id: string;
        title: string;
        status:
            | "DRAFT"
            | "PENDING_REVIEW"
            | "NEEDS_REVISION"
            | "REJECTED"
            | "APPROVED"
            | "PUBLISHED"
            | "COMPLETED";
    } | null;
    meeting: {
        id: string;
        title: string;
        status: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
    } | null;
}

export interface CheckpointDto {
    id: string;
    eventId: string | null;
    meetingId: string | null;
    parentKind: "EVENT" | "MEETING";
    parentTitle: string;
    termCode: string;
    label: string;
    audienceScope: CheckpointAudienceScope;
    sortOrder: number;
    opensAt: string | null;
    closesAt: string | null;
    status: CheckpointStatus;
    recordCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface SafeScanUserDto {
    id: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
}

export interface ExistingAttendanceSummary {
    id: string;
    status: AttendanceStatus;
    recordedAt: string;
    recordedVia: AttendanceRecordedVia;
}

export type VerificationCardState =
    | "READY"
    | "ALREADY_LOGGED"
    | "OFFICER_RESTRICTED"
    | "ACCOUNT_HOLD"
    | "AUDIENCE_MISMATCH"
    | "NOT_FOUND";

export interface LookupVerificationDto {
    verificationState: VerificationCardState;
    message: string;
    requiresBreakGlass: boolean;
    checkpoint: {
        id: string;
        label: string;
        audienceScope: CheckpointAudienceScope;
        parentKind: "EVENT" | "MEETING";
        parentTitle: string;
    };
    target: SafeScanUserDto | null;
    existingRecord: ExistingAttendanceSummary | null;
}

export interface AttendanceRecordDto {
    id: string;
    checkpointId: string;
    checkpointLabel: string;
    userId: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
    status: AttendanceStatus;
    recordedVia: AttendanceRecordedVia;
    recordedAt: string;
    recordedBy: {
        id: string;
        studentIdNumber: string;
        fullName: string;
    } | null;
    lastEditedBy: {
        id: string;
        studentIdNumber: string;
        fullName: string;
    } | null;
    lastEditedAt: string | null;
    editReason: string | null;
}

export async function resolveParentContext(
    executor: DbExecutor,
    input: { eventId?: string; meetingId?: string },
): Promise<CheckpointParentContext | null> {
    if (input.eventId) {
        const [row] = await executor
            .select({
                parentId: events.id,
                parentTitle: events.title,
                eventStatus: events.status,
                academicTermId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(events)
            .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
            .where(eq(events.id, input.eventId))
            .limit(1);

        if (!row) return null;
        return {
            kind: "EVENT",
            parentId: row.parentId,
            parentTitle: row.parentTitle,
            academicTermId: row.academicTermId,
            termCode: row.termCode,
            termName: row.termName,
            termStatus: row.termStatus,
            eventStatus: row.eventStatus,
        };
    }

    if (input.meetingId) {
        const [row] = await executor
            .select({
                parentId: meetings.id,
                parentTitle: meetings.title,
                meetingStatus: meetings.status,
                academicTermId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(meetings)
            .innerJoin(academicTerms, eq(meetings.academicTermId, academicTerms.id))
            .where(eq(meetings.id, input.meetingId))
            .limit(1);

        if (!row) return null;
        return {
            kind: "MEETING",
            parentId: row.parentId,
            parentTitle: row.parentTitle,
            academicTermId: row.academicTermId,
            termCode: row.termCode,
            termName: row.termName,
            termStatus: row.termStatus,
            meetingStatus: row.meetingStatus,
        };
    }

    return null;
}

export async function loadCheckpointContext(
    executor: DbExecutor,
    checkpointId: string,
): Promise<CheckpointContext | null> {
    const [checkpoint] = await executor
        .select()
        .from(attendanceCheckpoints)
        .where(eq(attendanceCheckpoints.id, checkpointId))
        .limit(1);

    if (!checkpoint) {
        return null;
    }

    if (checkpoint.eventId) {
        const [row] = await executor
            .select({
                eventId: events.id,
                eventTitle: events.title,
                eventStatus: events.status,
                termId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(events)
            .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
            .where(eq(events.id, checkpoint.eventId))
            .limit(1);

        if (!row) return null;
        return {
            checkpoint,
            term: {
                id: row.termId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            event: {
                id: row.eventId,
                title: row.eventTitle,
                status: row.eventStatus,
            },
            meeting: null,
        };
    }

    if (checkpoint.meetingId) {
        const [row] = await executor
            .select({
                meetingId: meetings.id,
                meetingTitle: meetings.title,
                meetingStatus: meetings.status,
                termId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(meetings)
            .innerJoin(academicTerms, eq(meetings.academicTermId, academicTerms.id))
            .where(eq(meetings.id, checkpoint.meetingId))
            .limit(1);

        if (!row) return null;
        return {
            checkpoint,
            term: {
                id: row.termId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            event: null,
            meeting: {
                id: row.meetingId,
                title: row.meetingTitle,
                status: row.meetingStatus,
            },
        };
    }

    return null;
}

export async function isTargetActiveOfficerForTerm(
    executor: DbExecutor,
    target: { id: string; systemRole: SystemRole },
    academicTermId: string,
): Promise<boolean> {
    if (target.systemRole !== "MEMBER") {
        return true;
    }
    const [appointment] = await executor
        .select({ id: officerAppointments.id })
        .from(officerAppointments)
        .where(
            and(
                eq(officerAppointments.userId, target.id),
                eq(officerAppointments.academicTermId, academicTermId),
                eq(officerAppointments.isCurrent, true),
            ),
        )
        .limit(1);
    return Boolean(appointment);
}

export function validateScanWindowAndParentLock(
    ctx: CheckpointContext,
    actorRole: SystemRole,
):
    | { ok: true }
    | {
          ok: false;
          status: 409;
          code: string;
          message: string;
      } {
    if (ctx.checkpoint.status !== "OPEN") {
        return {
            ok: false,
            status: 409,
            code: "CHECKPOINT_NOT_OPEN",
            message: "Checkpoint is not currently OPEN for scanning.",
        };
    }

    const isTermLocked = ctx.term.status === "CLOSED";
    const isEventLocked =
        ctx.event?.status === "COMPLETED" || ctx.event?.status === "REJECTED";
    const isMeetingLocked =
        ctx.meeting?.status === "COMPLETED" || ctx.meeting?.status === "CANCELLED";

    if (isTermLocked || isEventLocked || isMeetingLocked) {
        if (actorRole !== "SUPER_ADMIN") {
            return {
                ok: false,
                status: 409,
                code: "RESOURCE_LOCKED",
                message:
                    "Attendance scanning is locked for closed terms or completed/cancelled sessions.",
            };
        }
        return { ok: true };
    }

    if (ctx.event && ctx.event.status !== "PUBLISHED") {
        return {
            ok: false,
            status: 409,
            code: "EVENT_NOT_PUBLISHED",
            message: "Attendance scanning is only allowed for PUBLISHED events.",
        };
    }

    if (
        ctx.meeting &&
        ctx.meeting.status !== "SCHEDULED" &&
        ctx.meeting.status !== "ONGOING"
    ) {
        return {
            ok: false,
            status: 409,
            code: "MEETING_NOT_ACTIVE",
            message: "Attendance scanning is only allowed for SCHEDULED or ONGOING meetings.",
        };
    }

    return { ok: true };
}

export function toCheckpointDto(
    checkpoint: typeof attendanceCheckpoints.$inferSelect,
    meta: { parentKind: "EVENT" | "MEETING"; parentTitle: string; termCode: string; recordCount: number },
): CheckpointDto {
    return {
        id: checkpoint.id,
        eventId: checkpoint.eventId,
        meetingId: checkpoint.meetingId,
        parentKind: meta.parentKind,
        parentTitle: meta.parentTitle,
        termCode: meta.termCode,
        label: checkpoint.label,
        audienceScope: checkpoint.audienceScope,
        sortOrder: checkpoint.sortOrder,
        opensAt: checkpoint.opensAt ? checkpoint.opensAt.toISOString() : null,
        closesAt: checkpoint.closesAt ? checkpoint.closesAt.toISOString() : null,
        status: checkpoint.status,
        recordCount: meta.recordCount,
        createdAt: checkpoint.createdAt.toISOString(),
        updatedAt: checkpoint.updatedAt.toISOString(),
    };
}

export async function loadCheckpointsWithCounts(
    executor: DbExecutor,
    filters: {
        eventId?: string;
        meetingId?: string;
        status?: CheckpointStatus;
        forScanner?: boolean;
        actorRole?: SystemRole;
    },
): Promise<CheckpointDto[]> {
    const conditions: SQL[] = [];
    if (filters.eventId) {
        conditions.push(eq(attendanceCheckpoints.eventId, filters.eventId));
    }
    if (filters.meetingId) {
        conditions.push(eq(attendanceCheckpoints.meetingId, filters.meetingId));
    }
    if (filters.status) {
        conditions.push(eq(attendanceCheckpoints.status, filters.status));
    }
    if (filters.forScanner) {
        conditions.push(eq(attendanceCheckpoints.status, "OPEN"));
        if (filters.actorRole === "OFFICER") {
            conditions.push(sql`${attendanceCheckpoints.audienceScope} <> 'OFFICERS_ONLY'`);
        }
    }

    const rows = await executor
        .select({
            checkpoint: attendanceCheckpoints,
            eventTitle: events.title,
            eventStatus: events.status,
            meetingTitle: meetings.title,
            meetingStatus: meetings.status,
            termCode: academicTerms.code,
            termStatus: academicTerms.status,
        })
        .from(attendanceCheckpoints)
        .leftJoin(events, eq(attendanceCheckpoints.eventId, events.id))
        .leftJoin(meetings, eq(attendanceCheckpoints.meetingId, meetings.id))
        .leftJoin(
            academicTerms,
            sql`${academicTerms.id} = COALESCE(${events.academicTermId}, ${meetings.academicTermId})`,
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(attendanceCheckpoints.sortOrder), asc(attendanceCheckpoints.createdAt));

    const filteredRows = filters.forScanner
        ? rows.filter((row) => {
              if (row.termStatus === "CLOSED") return false;
              if (row.checkpoint.eventId) {
                  return row.eventStatus === "PUBLISHED";
              }
              if (row.checkpoint.meetingId) {
                  return row.meetingStatus === "SCHEDULED" || row.meetingStatus === "ONGOING";
              }
              return false;
          })
        : rows;

    const cpIds = filteredRows.map((r) => r.checkpoint.id);
    const counts =
        cpIds.length > 0
            ? await executor
                  .select({
                      checkpointId: attendanceRecords.checkpointId,
                      total: count(),
                  })
                  .from(attendanceRecords)
                  .where(inArray(attendanceRecords.checkpointId, cpIds))
                  .groupBy(attendanceRecords.checkpointId)
            : [];
    const countMap = new Map(counts.map((c) => [c.checkpointId, Number(c.total)]));

    return filteredRows.map((row) =>
        toCheckpointDto(row.checkpoint, {
            parentKind: row.checkpoint.eventId ? "EVENT" : "MEETING",
            parentTitle: row.eventTitle ?? row.meetingTitle ?? "Session",
            termCode: row.termCode ?? "",
            recordCount: countMap.get(row.checkpoint.id) ?? 0,
        }),
    );
}

export async function loadOpenScannerCheckpoints(
    executor: DbExecutor,
    actorRole: SystemRole,
): Promise<CheckpointDto[]> {
    return loadCheckpointsWithCounts(executor, {
        forScanner: true,
        actorRole,
    });
}

export function buildAttendanceRecordConditions(filter: AttendanceRecordsFilter): SQL[] {
    const conditions: SQL[] = [];

    if (filter.eventId) {
        conditions.push(eq(attendanceCheckpoints.eventId, filter.eventId));
    }
    if (filter.meetingId) {
        conditions.push(eq(attendanceCheckpoints.meetingId, filter.meetingId));
    }
    if (filter.checkpointId) {
        conditions.push(eq(attendanceRecords.checkpointId, filter.checkpointId));
    }
    if (filter.status) {
        conditions.push(eq(attendanceRecords.status, filter.status));
    }
    if (filter.q) {
        const pattern = `%${escapeLikePattern(filter.q)}%`;
        const searchExpr = or(
            ilike(users.studentIdNumber, pattern),
            ilike(users.fullName, pattern),
            ilike(attendanceCheckpoints.label, pattern),
        );
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }
    if (filter.from) {
        conditions.push(gte(attendanceRecords.recordedAt, manilaDayStartUtc(filter.from)));
    }
    if (filter.to) {
        conditions.push(lt(attendanceRecords.recordedAt, manilaNextDayStartUtc(filter.to)));
    }

    return conditions;
}

export async function queryAttendanceRecordsList(
    executor: DbExecutor,
    filter: AttendanceRecordsFilter,
    options: { page?: number; limit?: number; includeActors?: boolean } = {},
): Promise<{ items: AttendanceRecordDto[]; total: number }> {
    const conditions = buildAttendanceRecordConditions(filter);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = options.limit ?? ATTENDANCE_DEFAULT_LIMIT;
    const page = options.page ?? 1;
    const offset = (page - 1) * limit;

    const [[{ total }], rows] = await Promise.all([
        executor
            .select({ total: count() })
            .from(attendanceRecords)
            .innerJoin(
                attendanceCheckpoints,
                eq(attendanceRecords.checkpointId, attendanceCheckpoints.id),
            )
            .innerJoin(users, eq(attendanceRecords.userId, users.id))
            .where(whereClause),
        executor
            .select({
                id: attendanceRecords.id,
                checkpointId: attendanceRecords.checkpointId,
                checkpointLabel: attendanceCheckpoints.label,
                userId: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
                status: attendanceRecords.status,
                recordedVia: attendanceRecords.recordedVia,
                recordedAt: attendanceRecords.recordedAt,
                recordedById: attendanceRecords.recordedBy,
                lastEditedById: attendanceRecords.lastEditedBy,
                lastEditedAt: attendanceRecords.lastEditedAt,
                editReason: attendanceRecords.editReason,
            })
            .from(attendanceRecords)
            .innerJoin(
                attendanceCheckpoints,
                eq(attendanceRecords.checkpointId, attendanceCheckpoints.id),
            )
            .innerJoin(users, eq(attendanceRecords.userId, users.id))
            .where(whereClause)
            .orderBy(desc(attendanceRecords.recordedAt), desc(attendanceRecords.id))
            .limit(limit)
            .offset(offset),
    ]);

    const actorMap = new Map<string, { id: string; studentIdNumber: string; fullName: string }>();
    if (options.includeActors !== false && rows.length > 0) {
        const actorIds = Array.from(
            new Set(
                rows
                    .flatMap((r) => [r.recordedById, r.lastEditedById])
                    .filter((id): id is string => Boolean(id)),
            ),
        );
        if (actorIds.length > 0) {
            const actorRows = await executor
                .select({
                    id: users.id,
                    studentIdNumber: users.studentIdNumber,
                    fullName: users.fullName,
                })
                .from(users)
                .where(inArray(users.id, actorIds));
            for (const actorRow of actorRows) {
                actorMap.set(actorRow.id, actorRow);
            }
        }
    }

    const items: AttendanceRecordDto[] = rows.map((row) => ({
        id: row.id,
        checkpointId: row.checkpointId,
        checkpointLabel: row.checkpointLabel,
        userId: row.userId,
        studentIdNumber: row.studentIdNumber,
        fullName: row.fullName,
        systemRole: row.systemRole,
        status: row.status,
        recordedVia: row.recordedVia,
        recordedAt: row.recordedAt.toISOString(),
        recordedBy: actorMap.get(row.recordedById) ?? null,
        lastEditedBy: row.lastEditedById ? (actorMap.get(row.lastEditedById) ?? null) : null,
        lastEditedAt: row.lastEditedAt ? row.lastEditedAt.toISOString() : null,
        editReason: row.editReason,
    }));

    return { items, total: Number(total) };
}
