import { z } from "zod";
import type { SystemRole } from "@/config/permissions";
import { isValidCalendarDate } from "@/lib/admin/audit-logs";

export const TASK_STATUSES = ["TO_DO", "IN_PROGRESS", "FOR_REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASKS_DEFAULT_LIMIT = 50;
export const TASKS_MAX_LIMIT = 100;

export const TASK_ELIGIBLE_EVENT_STATUSES = new Set(["APPROVED", "PUBLISHED"]);

const isoDateTimeSchema = z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Provide a valid ISO date/time.");

const optionalNullableString = (max: number) =>
    z.preprocess(
        (val) => {
            if (val === undefined) return undefined;
            if (val === null) return null;
            if (typeof val === "string") {
                const trimmed = val.trim();
                return trimmed === "" ? null : trimmed;
            }
            return val;
        },
        z.string().max(max).nullable().optional(),
    );

const optionalNullableUuid = (message: string) =>
    z.preprocess(
        (val) => {
            if (val === undefined) return undefined;
            if (val === null) return null;
            if (typeof val === "string" && val.trim() === "") return null;
            return val;
        },
        z.string().uuid(message).nullable().optional(),
    );

const optionalNullableIsoDate = z.preprocess(
    (val) => {
        if (val === undefined) return undefined;
        if (val === null) return null;
        if (typeof val === "string" && val.trim() === "") return null;
        return val;
    },
    isoDateTimeSchema.nullable().optional(),
);

export const tasksListQuerySchema = z
    .object({
        scope: z.enum(["mine", "all"]).default("all"),
        termId: z.string().uuid("Invalid academic term ID.").optional(),
        eventId: z.string().uuid("Invalid event ID.").optional(),
        committeeId: z.string().uuid("Invalid committee ID.").optional(),
        generalOnly: z
            .enum(["true", "false"])
            .optional()
            .transform((val) => val === "true"),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        assigneeId: z.string().uuid("Invalid assignee ID.").optional(),
        overdueOnly: z
            .enum(["true", "false"])
            .optional()
            .transform((val) => val === "true"),
        q: z.string().trim().max(120).optional(),
        dueFrom: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        dueTo: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(TASKS_MAX_LIMIT).default(TASKS_DEFAULT_LIMIT),
    })
    .refine((data) => !data.dueFrom || !data.dueTo || data.dueTo >= data.dueFrom, {
        message: "'dueTo' date must be on or after 'dueFrom' date.",
        path: ["dueTo"],
    });

export type TasksListQuery = z.infer<typeof tasksListQuerySchema>;

export function parseTasksSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        scope: getParam("scope"),
        termId: getParam("termId"),
        eventId: getParam("eventId"),
        committeeId: getParam("committeeId"),
        generalOnly: getParam("generalOnly"),
        status: getParam("status"),
        priority: getParam("priority"),
        assigneeId: getParam("assigneeId"),
        overdueOnly: getParam("overdueOnly"),
        q: getParam("q"),
        dueFrom: getParam("dueFrom"),
        dueTo: getParam("dueTo"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

export const createTaskSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(3, "Task title must be at least 3 characters.")
            .max(200, "Task title must be at most 200 characters."),
        description: optionalNullableString(4000),
        eventId: optionalNullableUuid("Invalid event ID."),
        committeeId: optionalNullableUuid("Invalid committee ID."),
        priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
        dueAt: optionalNullableIsoDate,
        linkedDocumentId: optionalNullableUuid("Invalid linked document ID."),
        assigneeIds: z
            .array(z.string().uuid("Invalid assignee user ID."))
            .max(25, "A task can have at most 25 assignees.")
            .optional()
            .default([]),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((data) => !data.committeeId || Boolean(data.eventId), {
        message: "Committee-scoped tasks must specify their parent eventId.",
        path: ["committeeId"],
    });

export const updateTaskSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(3, "Task title must be at least 3 characters.")
            .max(200, "Task title must be at most 200 characters.")
            .optional(),
        description: optionalNullableString(4000),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        dueAt: optionalNullableIsoDate,
        committeeId: optionalNullableUuid("Invalid committee ID."),
        linkedDocumentId: optionalNullableUuid("Invalid linked document ID."),
        assigneeIds: z
            .array(z.string().uuid("Invalid assignee user ID."))
            .max(25, "A task can have at most 25 assignees.")
            .optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (data) =>
            data.title !== undefined ||
            data.description !== undefined ||
            data.status !== undefined ||
            data.priority !== undefined ||
            data.dueAt !== undefined ||
            data.committeeId !== undefined ||
            data.linkedDocumentId !== undefined ||
            data.assigneeIds !== undefined,
        { message: "Provide at least one task field to update." },
    );

export const deleteTaskSchema = z
    .object({
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export function isReviewerOnlyStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return false;
    if (to === "DONE") return true;
    if (from === "DONE") return true;
    if (from === "FOR_REVIEW" && to !== "FOR_REVIEW") return true;
    return false;
}

export function isTaskOverdue(
    status: TaskStatus,
    dueAt: string | Date | null,
    nowMs = Date.now(),
): boolean {
    if (status === "DONE" || !dueAt) return false;
    const dueMs = dueAt instanceof Date ? dueAt.getTime() : Date.parse(dueAt);
    return !Number.isNaN(dueMs) && dueMs < nowMs;
}

export function isPgForeignKeyViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const rec = error as { code?: unknown; cause?: { code?: unknown } };
    return rec.code === "23503" || rec.cause?.code === "23503";
}

export interface TaskActorSummary {
    id: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
}

export interface TaskAssigneeDto {
    userId: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
    assignedAt: string;
}

export interface TaskDto {
    id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt: string | null;
    isOverdue: boolean;
    academicTerm: {
        id: string;
        code: string;
        name: string;
        status: "DRAFT" | "ACTIVE" | "CLOSED";
    };
    event: {
        id: string;
        slug: string;
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
    committee: {
        id: string;
        name: string;
        headUserId: string;
    } | null;
    linkedDocument: {
        id: string;
        title: string;
        webViewLink: string;
    } | null;
    assignees: TaskAssigneeDto[];
    createdBy: TaskActorSummary | null;
    completedBy: TaskActorSummary | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface EventTaskProgressSummary {
    taskCount: number;
    completedTaskCount: number;
    byCommittee: Record<string, { total: number; done: number }>;
}

export interface TaskWorkspaceEventOption {
    id: string;
    slug: string;
    title: string;
    status:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "NEEDS_REVISION"
        | "REJECTED"
        | "APPROVED"
        | "PUBLISHED"
        | "COMPLETED";
    academicTermId: string;
    academicTermCode: string;
    academicTermStatus: "DRAFT" | "ACTIVE" | "CLOSED";
}

export interface TaskWorkspaceCommitteeOption {
    id: string;
    eventId: string;
    name: string;
    headUserId: string;
    isActorHead: boolean;
}

export interface TaskDocumentOption {
    id: string;
    title: string;
    eventId: string | null;
}
