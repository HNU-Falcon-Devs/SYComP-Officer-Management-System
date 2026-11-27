import { z } from "zod";
import { isValidCalendarDate } from "@/lib/admin/audit-logs";

export const MEETING_STATUSES = ["SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETINGS_DEFAULT_LIMIT = 25;
export const MEETINGS_MAX_LIMIT = 100;

export const ALLOWED_MEETING_TRANSITIONS: Record<MeetingStatus, readonly MeetingStatus[]> = {
    SCHEDULED: ["ONGOING", "CANCELLED"],
    ONGOING: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
};

const optionalUuid = z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().uuid("Invalid identifier.").optional(),
);

const optionalIsoDateTime = z.preprocess(
    (val) => (val === "" ? null : val),
    z.iso.datetime({ offset: true }).nullable().optional(),
);

const optionalNullableLocation = z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? null : val),
    z.string().trim().max(255, "Location or link must be at most 255 characters.").nullable().optional(),
);

const optionalNullableHtml = (maxLen: number) =>
    z.preprocess(
        (val) => (typeof val === "string" && val.trim() === "" ? null : val),
        z.string().max(maxLen).nullable().optional(),
    );

export const createMeetingSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(2, "Meeting title must be at least 2 characters.")
            .max(200, "Meeting title must be at most 200 characters."),
        scheduledStartAt: z.iso.datetime({
            offset: true,
            error: "Provide a valid ISO datetime with timezone offset for scheduled start.",
        }),
        scheduledEndAt: optionalIsoDateTime,
        locationOrLink: optionalNullableLocation,
        agendaHtml: optionalNullableHtml(50_000),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .refine(
        (d) =>
            !d.scheduledEndAt ||
            new Date(d.scheduledEndAt).getTime() >= new Date(d.scheduledStartAt).getTime(),
        {
            message: "Scheduled end time must be on or after start time.",
            path: ["scheduledEndAt"],
        },
    );

export const updateMeetingSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(2, "Meeting title must be at least 2 characters.")
            .max(200, "Meeting title must be at most 200 characters.")
            .optional(),
        scheduledStartAt: z.iso
            .datetime({
                offset: true,
                error: "Provide a valid ISO datetime with timezone offset for scheduled start.",
            })
            .optional(),
        scheduledEndAt: optionalIsoDateTime,
        locationOrLink: optionalNullableLocation,
        agendaHtml: optionalNullableHtml(50_000),
        status: z.enum(MEETING_STATUSES).optional(),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine(
        (d) =>
            d.title !== undefined ||
            d.scheduledStartAt !== undefined ||
            d.scheduledEndAt !== undefined ||
            d.locationOrLink !== undefined ||
            d.agendaHtml !== undefined ||
            d.status !== undefined,
        {
            message: "Provide at least one meeting field to update.",
        },
    );

export const updateMeetingMinutesSchema = z
    .object({
        minutesHtml: z.preprocess(
            (val) => (typeof val === "string" && val.trim() === "" ? null : val),
            z.string().max(100_000, "Minutes content exceeds maximum length.").nullable(),
        ),
        breakGlass: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
    })
    .strict();

export const meetingsListQuerySchema = z
    .object({
        academicTermId: optionalUuid,
        status: z.enum(MEETING_STATUSES).optional(),
        q: z.string().trim().max(100).optional(),
        from: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        to: z.string().refine(isValidCalendarDate, "Use a valid YYYY-MM-DD date.").optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(MEETINGS_MAX_LIMIT)
            .default(MEETINGS_DEFAULT_LIMIT),
    })
    .refine((d) => !d.from || !d.to || d.to >= d.from, {
        message: "'to' date must be on or after 'from' date.",
        path: ["to"],
    });

export type MeetingsListQuery = z.infer<typeof meetingsListQuerySchema>;

export function parseMeetingsSearchParams(searchParams: URLSearchParams) {
    const getParam = (key: string) => {
        const value = searchParams.get(key);
        return value && value.trim() !== "" ? value : undefined;
    };
    return {
        academicTermId: getParam("academicTermId"),
        status: getParam("status"),
        q: getParam("q"),
        from: getParam("from"),
        to: getParam("to"),
        page: getParam("page"),
        limit: getParam("limit"),
    };
}

const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/** Converts an HTML datetime-local string (interpreted in Asia/Manila UTC+08:00) to an ISO offset string. */
export function manilaDateTimeLocalToIso(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || !DATETIME_LOCAL_RE.test(trimmed)) {
        return null;
    }
    const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    const parsed = new Date(`${withSeconds}+08:00`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return `${withSeconds}+08:00`;
}

const manilaInputFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/** Formats a UTC ISO timestamp as a YYYY-MM-DDTHH:mm string in Asia/Manila for datetime-local inputs. */
export function isoToManilaDateTimeLocal(iso: string | null | undefined): string {
    if (!iso) {
        return "";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const parts = Object.fromEntries(
        manilaInputFormatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

export interface MeetingActorSummary {
    id: string;
    studentIdNumber: string;
    fullName: string;
}

export interface MeetingTermOption {
    id: string;
    code: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
}

export interface MeetingListItemDto {
    id: string;
    title: string;
    status: MeetingStatus;
    scheduledStartAt: string;
    scheduledEndAt: string | null;
    locationOrLink: string | null;
    completedAt: string | null;
    academicTerm: MeetingTermOption;
    createdBy: MeetingActorSummary | null;
    checkpointCount: number;
    openCheckpointCount: number;
    documentCount: number;
    hasMinutes: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MeetingDetailDto extends MeetingListItemDto {
    agendaHtml: string | null;
    minutesHtml: string | null;
}
