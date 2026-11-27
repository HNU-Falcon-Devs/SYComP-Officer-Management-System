import "server-only";
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import {
    academicTerms,
    attendanceCheckpoints,
    documents,
    meetings,
    officerAppointments,
    users,
} from "@/db/schema";
import {
    escapeLikePattern,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
} from "@/lib/admin/audit-logs";
import { sanitizeRichText } from "@/lib/security/sanitize";
import type {
    MeetingActorSummary,
    MeetingDetailDto,
    MeetingListItemDto,
    MeetingsListQuery,
    MeetingTermOption,
} from "./validation";

export function sanitizeNullableRichText(html: string | null | undefined): string | null {
    if (!html || !html.trim()) {
        return null;
    }
    const clean = sanitizeRichText(html).trim();
    return clean.length > 0 ? clean : null;
}

export function buildMeetingListConditions(filter: Partial<MeetingsListQuery>): SQL[] {
    const conditions: SQL[] = [];
    if (filter.academicTermId) {
        conditions.push(eq(meetings.academicTermId, filter.academicTermId));
    }
    if (filter.status) {
        conditions.push(eq(meetings.status, filter.status));
    }
    if (filter.q) {
        const pattern = `%${escapeLikePattern(filter.q)}%`;
        const searchExpr = or(
            ilike(meetings.title, pattern),
            ilike(meetings.locationOrLink, pattern),
        );
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }
    if (filter.from) {
        conditions.push(gte(meetings.scheduledStartAt, manilaDayStartUtc(filter.from)));
    }
    if (filter.to) {
        conditions.push(lt(meetings.scheduledStartAt, manilaNextDayStartUtc(filter.to)));
    }
    return conditions;
}

async function loadMeetingCounts(
    executor: DbExecutor,
    meetingIds: string[],
): Promise<{
    checkpointCounts: Map<string, { total: number; open: number }>;
    documentCounts: Map<string, number>;
}> {
    const checkpointCounts = new Map<string, { total: number; open: number }>();
    const documentCounts = new Map<string, number>();

    if (meetingIds.length === 0) {
        return { checkpointCounts, documentCounts };
    }

    const [cpRows, docRows] = await Promise.all([
        executor
            .select({
                meetingId: attendanceCheckpoints.meetingId,
                total: count(),
                openCount: sql<number>`count(*) filter (where ${attendanceCheckpoints.status} = 'OPEN')`,
            })
            .from(attendanceCheckpoints)
            .where(inArray(attendanceCheckpoints.meetingId, meetingIds))
            .groupBy(attendanceCheckpoints.meetingId),
        executor
            .select({
                meetingId: documents.meetingId,
                total: count(),
            })
            .from(documents)
            .where(inArray(documents.meetingId, meetingIds))
            .groupBy(documents.meetingId),
    ]);

    for (const row of cpRows) {
        if (row.meetingId) {
            checkpointCounts.set(row.meetingId, {
                total: Number(row.total),
                open: Number(row.openCount),
            });
        }
    }
    for (const row of docRows) {
        if (row.meetingId) {
            documentCounts.set(row.meetingId, Number(row.total));
        }
    }

    return { checkpointCounts, documentCounts };
}

export async function queryMeetingsList(
    executor: DbExecutor,
    filter: Partial<MeetingsListQuery> & { page: number; limit: number },
): Promise<{ items: MeetingListItemDto[]; total: number }> {
    const conditions = buildMeetingListConditions(filter);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filter.page - 1) * filter.limit;

    const [[{ total }], rows] = await Promise.all([
        executor.select({ total: count() }).from(meetings).where(whereClause),
        executor
            .select({
                meeting: meetings,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
                creatorId: users.id,
                creatorStudentIdNumber: users.studentIdNumber,
                creatorFullName: users.fullName,
            })
            .from(meetings)
            .innerJoin(academicTerms, eq(meetings.academicTermId, academicTerms.id))
            .leftJoin(users, eq(meetings.createdBy, users.id))
            .where(whereClause)
            .orderBy(desc(meetings.scheduledStartAt), desc(meetings.id))
            .limit(filter.limit)
            .offset(offset),
    ]);

    const meetingIds = rows.map((r) => r.meeting.id);
    const { checkpointCounts, documentCounts } = await loadMeetingCounts(executor, meetingIds);

    const items: MeetingListItemDto[] = rows.map((row) => {
        const cp = checkpointCounts.get(row.meeting.id);
        const creator: MeetingActorSummary | null = row.creatorId
            ? {
                  id: row.creatorId,
                  studentIdNumber: row.creatorStudentIdNumber ?? "",
                  fullName: row.creatorFullName ?? "",
              }
            : null;

        return {
            id: row.meeting.id,
            title: row.meeting.title,
            status: row.meeting.status,
            scheduledStartAt: row.meeting.scheduledStartAt.toISOString(),
            scheduledEndAt: row.meeting.scheduledEndAt
                ? row.meeting.scheduledEndAt.toISOString()
                : null,
            locationOrLink: row.meeting.locationOrLink,
            completedAt: row.meeting.completedAt ? row.meeting.completedAt.toISOString() : null,
            academicTerm: {
                id: row.meeting.academicTermId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            createdBy: creator,
            checkpointCount: cp?.total ?? 0,
            openCheckpointCount: cp?.open ?? 0,
            documentCount: documentCounts.get(row.meeting.id) ?? 0,
            hasMinutes: Boolean(row.meeting.minutesHtml && row.meeting.minutesHtml.trim()),
            createdAt: row.meeting.createdAt.toISOString(),
            updatedAt: row.meeting.updatedAt.toISOString(),
        };
    });

    return {
        items,
        total: Number(total),
    };
}

export async function loadMeetingDetailById(
    executor: DbExecutor,
    meetingId: string,
): Promise<{
    dto: MeetingDetailDto;
    raw: typeof meetings.$inferSelect;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
} | null> {
    const [row] = await executor
        .select({
            meeting: meetings,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
            creatorId: users.id,
            creatorStudentIdNumber: users.studentIdNumber,
            creatorFullName: users.fullName,
        })
        .from(meetings)
        .innerJoin(academicTerms, eq(meetings.academicTermId, academicTerms.id))
        .leftJoin(users, eq(meetings.createdBy, users.id))
        .where(eq(meetings.id, meetingId))
        .limit(1);

    if (!row) {
        return null;
    }

    const { checkpointCounts, documentCounts } = await loadMeetingCounts(executor, [row.meeting.id]);
    const cp = checkpointCounts.get(row.meeting.id);
    const sanitizedAgenda = sanitizeNullableRichText(row.meeting.agendaHtml);
    const sanitizedMinutes = sanitizeNullableRichText(row.meeting.minutesHtml);

    return {
        dto: {
            id: row.meeting.id,
            title: row.meeting.title,
            status: row.meeting.status,
            scheduledStartAt: row.meeting.scheduledStartAt.toISOString(),
            scheduledEndAt: row.meeting.scheduledEndAt
                ? row.meeting.scheduledEndAt.toISOString()
                : null,
            locationOrLink: row.meeting.locationOrLink,
            completedAt: row.meeting.completedAt ? row.meeting.completedAt.toISOString() : null,
            academicTerm: {
                id: row.meeting.academicTermId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            createdBy: row.creatorId
                ? {
                      id: row.creatorId,
                      studentIdNumber: row.creatorStudentIdNumber ?? "",
                      fullName: row.creatorFullName ?? "",
                  }
                : null,
            checkpointCount: cp?.total ?? 0,
            openCheckpointCount: cp?.open ?? 0,
            documentCount: documentCounts.get(row.meeting.id) ?? 0,
            hasMinutes: Boolean(sanitizedMinutes),
            agendaHtml: sanitizedAgenda,
            minutesHtml: sanitizedMinutes,
            createdAt: row.meeting.createdAt.toISOString(),
            updatedAt: row.meeting.updatedAt.toISOString(),
        },
        raw: row.meeting,
        termStatus: row.termStatus,
    };
}

export async function loadMeetingsPageMeta(executor: DbExecutor): Promise<{
    terms: MeetingTermOption[];
    activeTerm: MeetingTermOption | null;
}> {
    const terms = await executor
        .select({
            id: academicTerms.id,
            code: academicTerms.code,
            name: academicTerms.name,
            status: academicTerms.status,
        })
        .from(academicTerms)
        .orderBy(desc(academicTerms.startDate));

    return {
        terms,
        activeTerm: terms.find((t) => t.status === "ACTIVE") ?? null,
    };
}

export async function hasActiveTermAppointment(
    executor: DbExecutor,
    userId: string,
    academicTermId: string,
): Promise<boolean> {
    const [row] = await executor
        .select({ id: officerAppointments.id })
        .from(officerAppointments)
        .where(
            and(
                eq(officerAppointments.userId, userId),
                eq(officerAppointments.academicTermId, academicTermId),
                eq(officerAppointments.isCurrent, true),
            ),
        )
        .limit(1);

    return Boolean(row);
}
