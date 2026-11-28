import { z } from "zod";
import type { AccountStatus, SystemRole } from "@/config/permissions";
import { isValidCalendarDate } from "@/lib/admin/audit-logs";

export const EVENT_STATUSES = [
    "DRAFT",
    "PENDING_REVIEW",
    "NEEDS_REVISION",
    "REJECTED",
    "APPROVED",
    "PUBLISHED",
    "COMPLETED",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_PROPOSAL_DECISIONS = [
    "COMMENT",
    "REQUEST_REVISION",
    "APPROVED",
    "REJECTED",
    "UNPUBLISHED",
] as const;

export type EventProposalDecision = (typeof EVENT_PROPOSAL_DECISIONS)[number];

export const EVENT_TRANSITION_ACTIONS = [
    "SUBMIT",
    "RESUBMIT",
    "REQUEST_REVISION",
    "APPROVE",
    "REJECT",
    "PUBLISH",
    "UNPUBLISH",
    "COMPLETE",
] as const;

export type EventTransitionAction = (typeof EVENT_TRANSITION_ACTIONS)[number];

export const EVENTS_DEFAULT_LIMIT = 25;
export const EVENTS_MAX_LIMIT = 100;

export const ALLOWED_EVENT_TRANSITIONS: Record<
    EventTransitionAction,
    { from: readonly EventStatus[]; to: EventStatus }
> = {
    SUBMIT: { from: ["DRAFT"], to: "PENDING_REVIEW" },
    RESUBMIT: { from: ["NEEDS_REVISION"], to: "PENDING_REVIEW" },
    REQUEST_REVISION: { from: ["PENDING_REVIEW"], to: "NEEDS_REVISION" },
    APPROVE: { from: ["PENDING_REVIEW"], to: "APPROVED" },
    REJECT: { from: ["PENDING_REVIEW"], to: "REJECTED" },
    PUBLISH: { from: ["APPROVED"], to: "PUBLISHED" },
    UNPUBLISH: { from: ["PUBLISHED"], to: "APPROVED" },
    COMPLETE: { from: ["PUBLISHED"], to: "COMPLETED" },
};

export const COMMITTEE_ELIGIBLE_EVENT_STATUSES = new Set<EventStatus>(["APPROVED", "PUBLISHED"]);

export const PROPOSAL_WORKSPACE_STATUSES: readonly EventStatus[] = [
    "DRAFT",
    "PENDING_REVIEW",
    "NEEDS_REVISION",
    "REJECTED",
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(value: string): boolean {
    return UUID_RE.test(value);
}

export function slugifyEventTitle(title: string): string {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 180)
        .replace(/-+$/g, "");
    return base.length >= 2 ? base : "event-proposal";
}

export function stripHtmlToPlainText(html: string): string {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

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

export const eventSlugSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug must be at least 2 characters.")
    .max(220, "Slug must be at most 220 characters.")
    .regex(SLUG_RE, "Slug must use lowercase letters, numbers, and single hyphens.");

export const eventsListQuerySchema = z
    .object({
        termId: z.string().uuid("Invalid academic term ID.").optional(),
        status: z.enum(EVENT_STATUSES).optional(),
        view: z.enum(["all", "proposals", "active", "archived"]).optional(),
        q: z.string().trim().max(120).optional(),
        from: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        to: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(EVENTS_MAX_LIMIT)
            .default(EVENTS_DEFAULT_LIMIT),
    })
    .refine((data) => !data.from || !data.to || data.to >= data.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export type EventsListQuery = z.infer<typeof eventsListQuerySchema>;

export function parseEventsSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        termId: getParam("termId"),
        status: getParam("status"),
        view: getParam("view"),
        q: getParam("q"),
        from: getParam("from"),
        to: getParam("to"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

export const createEventSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(3, "Event title must be at least 3 characters.")
            .max(200, "Event title must be at most 200 characters."),
        slug: z.preprocess(
            (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
            eventSlugSchema.optional(),
        ),
        descriptionHtml: z
            .string()
            .trim()
            .min(1, "Proposal description is required.")
            .max(60_000, "Proposal description is too long."),
        publicSummary: optionalNullableString(2000),
        venue: optionalNullableString(255),
        targetAudience: optionalNullableString(150),
        startAt: isoDateTimeSchema,
        endAt: isoDateTimeSchema,
        submitImmediately: z.boolean().optional().default(false),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((data) => Date.parse(data.endAt) >= Date.parse(data.startAt), {
        message: "Event end time must be on or after start time.",
        path: ["endAt"],
    });

export const updateEventSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(3, "Event title must be at least 3 characters.")
            .max(200, "Event title must be at most 200 characters.")
            .optional(),
        descriptionHtml: z
            .string()
            .trim()
            .min(1, "Proposal description cannot be empty.")
            .max(60_000, "Proposal description is too long.")
            .optional(),
        publicSummary: optionalNullableString(2000),
        venue: optionalNullableString(255),
        targetAudience: optionalNullableString(150),
        startAt: isoDateTimeSchema.optional(),
        endAt: isoDateTimeSchema.optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (data) =>
            data.title !== undefined ||
            data.descriptionHtml !== undefined ||
            data.publicSummary !== undefined ||
            data.venue !== undefined ||
            data.targetAudience !== undefined ||
            data.startAt !== undefined ||
            data.endAt !== undefined,
        { message: "Provide at least one field to update." },
    );

export const transitionEventSchema = z
    .object({
        action: z.enum(EVENT_TRANSITION_ACTIONS),
        feedbackNote: optionalNullableString(2000),
        venue: optionalNullableString(255),
        publicSummary: optionalNullableString(2000),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export const createReviewCommentSchema = z
    .object({
        feedbackNote: z
            .string()
            .trim()
            .min(2, "Review comment must be at least 2 characters.")
            .max(2000, "Review comment must be at most 2000 characters."),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export const createCommitteeSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Committee name must be at least 2 characters.")
            .max(120, "Committee name must be at most 120 characters."),
        description: optionalNullableString(1000),
        headUserId: z.string().uuid("Select a valid active Officer as Committee Head."),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export const updateCommitteeSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Committee name must be at least 2 characters.")
            .max(120, "Committee name must be at most 120 characters.")
            .optional(),
        description: optionalNullableString(1000),
        headUserId: z.string().uuid("Select a valid active Officer as Committee Head.").optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (data) =>
            data.name !== undefined ||
            data.description !== undefined ||
            data.headUserId !== undefined,
        { message: "Provide at least one committee field to update." },
    );

export const committeeMemberMutationSchema = z
    .object({
        userId: z.string().uuid("Select a valid active Officer."),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export interface EventActorSummary {
    id: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
}

export interface EventListItemDto {
    id: string;
    slug: string;
    title: string;
    publicSummary: string | null;
    venue: string | null;
    targetAudience: string | null;
    startAt: string;
    endAt: string;
    status: EventStatus;
    revisionCount: number;
    academicTerm: {
        id: string;
        code: string;
        name: string;
        status: "DRAFT" | "ACTIVE" | "CLOSED";
    };
    createdBy: EventActorSummary | null;
    committeeCount: number;
    taskCount: number;
    openCheckpointCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface EventDetailDto extends EventListItemDto {
    descriptionHtml: string;
    approvedBy: EventActorSummary | null;
    approvedAt: string | null;
    publishedBy: EventActorSummary | null;
    publishedAt: string | null;
    completedBy: EventActorSummary | null;
    completedAt: string | null;
    documentCount: number;
    checkpointCount: number;
    completedTaskCount: number;
}

export interface EventProposalReviewDto {
    id: string;
    eventId: string;
    decisionType: EventProposalDecision;
    feedbackNote: string | null;
    revisionNumber: number;
    reviewer: EventActorSummary | null;
    createdAt: string;
}

export interface CommitteeMemberDto {
    userId: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
    positionTitle: string | null;
    addedAt: string;
}

export interface EventCommitteeDto {
    id: string;
    eventId: string;
    name: string;
    description: string | null;
    head: {
        id: string;
        studentIdNumber: string;
        fullName: string;
        systemRole: SystemRole;
        accountStatus: AccountStatus;
        positionTitle: string | null;
        hasActiveAppointment: boolean;
    };
    headNeedsReassignment: boolean;
    members: CommitteeMemberDto[];
    taskTotal: number;
    taskDone: number;
    createdAt: string;
    updatedAt: string;
}

export interface EligibleOfficerOption {
    userId: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
    positionTitle: string;
}

export interface PublicPortalEventDto {
    id: string;
    slug: string;
    title: string;
    publicSummary: string | null;
    venue: string | null;
    targetAudience: string | null;
    startAt: string;
    endAt: string;
    status: "PUBLISHED" | "COMPLETED";
    academicTerm: {
        code: string;
        name: string;
    };
}
