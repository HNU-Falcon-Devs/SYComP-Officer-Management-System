import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import type { SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import {
    academicTerms,
    attendanceCheckpoints,
    documents,
    eventCommitteeMembers,
    eventCommittees,
    eventProposalReviews,
    events,
    officerAppointments,
    tasks,
    users,
} from "@/db/schema";
import {
    escapeLikePattern,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
} from "@/lib/admin/audit-logs";
import {
    isUuidString,
    PROPOSAL_WORKSPACE_STATUSES,
    slugifyEventTitle,
    type EligibleOfficerOption,
    type EventActorSummary,
    type EventCommitteeDto,
    type EventDetailDto,
    type EventListItemDto,
    type EventProposalReviewDto,
    type EventsListQuery,
    type EventStatus,
} from "./validation";

export interface LoadedEventRecord {
    raw: typeof events.$inferSelect;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    dto: EventDetailDto;
}

async function loadActorsByIds(
    db: DbExecutor,
    ids: Array<string | null | undefined>,
): Promise<Map<string, EventActorSummary>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    if (unique.length === 0) {
        return new Map();
    }
    const rows = await db
        .select({
            id: users.id,
            studentIdNumber: users.studentIdNumber,
            fullName: users.fullName,
            systemRole: users.systemRole,
        })
        .from(users)
        .where(inArray(users.id, unique));
    return new Map(rows.map((row) => [row.id, row]));
}

export async function generateUniqueEventSlug(
    db: DbExecutor,
    preferredTitleOrSlug: string,
    explicitSlug?: string,
): Promise<string> {
    const base = explicitSlug ? explicitSlug : slugifyEventTitle(preferredTitleOrSlug);
    if (explicitSlug) {
        return base;
    }

    const existing = await db
        .select({ slug: events.slug })
        .from(events)
        .where(ilike(events.slug, `${escapeLikePattern(base)}%`));

    const used = new Set(existing.map((row) => row.slug.toLowerCase()));
    if (!used.has(base)) {
        return base;
    }

    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${base.slice(0, 210)}-${suffix}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    return `${base.slice(0, 200)}-${Date.now().toString(36)}`;
}

export async function hasActiveTermOfficerAppointment(
    db: DbExecutor,
    userId: string,
    academicTermId: string,
): Promise<boolean> {
    const [row] = await db
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

export async function isEligibleActiveTermOfficer(
    db: DbExecutor,
    userId: string,
    academicTermId: string,
): Promise<{
    eligible: boolean;
    reason?: string;
    user?: {
        id: string;
        studentIdNumber: string;
        fullName: string;
        systemRole: SystemRole;
    };
}> {
    const [user] = await db
        .select({
            id: users.id,
            studentIdNumber: users.studentIdNumber,
            fullName: users.fullName,
            systemRole: users.systemRole,
            accountStatus: users.accountStatus,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        return { eligible: false, reason: "Selected user was not found." };
    }
    if (user.accountStatus !== "ACTIVE") {
        return {
            eligible: false,
            reason: "Selected user account is not ACTIVE.",
        };
    }
    if (user.systemRole === "MEMBER") {
        return {
            eligible: false,
            reason: "General Members cannot hold Event Committee roles (BR-COM-02).",
        };
    }

    const hasAppointment = await hasActiveTermOfficerAppointment(db, user.id, academicTermId);
    if (!hasAppointment) {
        return {
            eligible: false,
            reason: "Selected user must hold an active officer appointment in this academic term (BR-COM-02).",
        };
    }

    return {
        eligible: true,
        user: {
            id: user.id,
            studentIdNumber: user.studentIdNumber,
            fullName: user.fullName,
            systemRole: user.systemRole,
        },
    };
}

export async function loadEligibleOfficersForTerm(
    db: DbExecutor,
    academicTermId: string,
): Promise<EligibleOfficerOption[]> {
    const rows = await db
        .select({
            userId: users.id,
            studentIdNumber: users.studentIdNumber,
            fullName: users.fullName,
            systemRole: users.systemRole,
            positionTitle: officerAppointments.positionTitle,
        })
        .from(officerAppointments)
        .innerJoin(users, eq(officerAppointments.userId, users.id))
        .where(
            and(
                eq(officerAppointments.academicTermId, academicTermId),
                eq(officerAppointments.isCurrent, true),
                eq(users.accountStatus, "ACTIVE"),
                ne(users.systemRole, "MEMBER"),
            ),
        )
        .orderBy(asc(users.fullName));

    const seen = new Set<string>();
    const deduped: EligibleOfficerOption[] = [];
    for (const row of rows) {
        if (seen.has(row.userId)) continue;
        seen.add(row.userId);
        deduped.push(row);
    }
    return deduped;
}

export async function queryEventsList(
    db: DbExecutor,
    actor: { id: string; systemRole: SystemRole },
    query: EventsListQuery,
): Promise<{ items: EventListItemDto[]; total: number }> {
    const conditions: SQL[] = [];

    // BR-EVT-01: DRAFT proposals are visible only to author, EXECUTIVE, and SUPER_ADMIN
    if (actor.systemRole === "OFFICER") {
        const draftVisibility = or(
            ne(events.status, "DRAFT"),
            eq(events.createdBy, actor.id),
        );
        if (draftVisibility) {
            conditions.push(draftVisibility);
        }
    }

    if (query.termId) {
        conditions.push(eq(events.academicTermId, query.termId));
    }

    if (query.status) {
        conditions.push(eq(events.status, query.status));
    } else if (query.view === "proposals") {
        conditions.push(inArray(events.status, [...PROPOSAL_WORKSPACE_STATUSES]));
    } else if (query.view === "active") {
        conditions.push(inArray(events.status, ["APPROVED", "PUBLISHED"]));
    } else if (query.view === "archived") {
        conditions.push(inArray(events.status, ["COMPLETED", "REJECTED"]));
    }

    if (query.q) {
        const pattern = `%${escapeLikePattern(query.q)}%`;
        const searchExpr = or(
            ilike(events.title, pattern),
            ilike(events.venue, pattern),
            ilike(events.targetAudience, pattern),
            ilike(events.slug, pattern),
        );
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }

    if (query.from) {
        conditions.push(gte(events.startAt, manilaDayStartUtc(query.from)));
    }
    if (query.to) {
        conditions.push(lt(events.startAt, manilaNextDayStartUtc(query.to)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [{ total }] = await db
        .select({ total: count() })
        .from(events)
        .where(whereClause);

    const rows = await db
        .select({
            id: events.id,
            slug: events.slug,
            title: events.title,
            publicSummary: events.publicSummary,
            venue: events.venue,
            targetAudience: events.targetAudience,
            startAt: events.startAt,
            endAt: events.endAt,
            status: events.status,
            revisionCount: events.revisionCount,
            createdBy: events.createdBy,
            createdAt: events.createdAt,
            updatedAt: events.updatedAt,
            termId: academicTerms.id,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
        })
        .from(events)
        .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
        .where(whereClause)
        .orderBy(desc(events.startAt), desc(events.createdAt))
        .limit(query.limit)
        .offset(offset);

    if (rows.length === 0) {
        return { items: [], total: Number(total) };
    }

    const eventIds = rows.map((row) => row.id);
    const [actorMap, committeeCounts, taskCounts, openCpCounts] = await Promise.all([
        loadActorsByIds(
            db,
            rows.map((r) => r.createdBy),
        ),
        db
            .select({ eventId: eventCommittees.eventId, cnt: count() })
            .from(eventCommittees)
            .where(inArray(eventCommittees.eventId, eventIds))
            .groupBy(eventCommittees.eventId),
        db
            .select({ eventId: tasks.eventId, cnt: count() })
            .from(tasks)
            .where(inArray(tasks.eventId, eventIds))
            .groupBy(tasks.eventId),
        db
            .select({ eventId: attendanceCheckpoints.eventId, cnt: count() })
            .from(attendanceCheckpoints)
            .where(
                and(
                    inArray(attendanceCheckpoints.eventId, eventIds),
                    eq(attendanceCheckpoints.status, "OPEN"),
                ),
            )
            .groupBy(attendanceCheckpoints.eventId),
    ]);

    const committeeMap = new Map(committeeCounts.map((r) => [r.eventId, Number(r.cnt)]));
    const taskMap = new Map(
        taskCounts
            .filter((r): r is { eventId: string; cnt: number } => Boolean(r.eventId))
            .map((r) => [r.eventId, Number(r.cnt)]),
    );
    const openCpMap = new Map(
        openCpCounts
            .filter((r): r is { eventId: string; cnt: number } => Boolean(r.eventId))
            .map((r) => [r.eventId, Number(r.cnt)]),
    );

    const items: EventListItemDto[] = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        publicSummary: row.publicSummary,
        venue: row.venue,
        targetAudience: row.targetAudience,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        status: row.status as EventStatus,
        revisionCount: row.revisionCount,
        academicTerm: {
            id: row.termId,
            code: row.termCode,
            name: row.termName,
            status: row.termStatus,
        },
        createdBy: actorMap.get(row.createdBy) ?? null,
        committeeCount: committeeMap.get(row.id) ?? 0,
        taskCount: taskMap.get(row.id) ?? 0,
        openCheckpointCount: openCpMap.get(row.id) ?? 0,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }));

    return { items, total: Number(total) };
}

export async function loadEventDetailByIdOrSlug(
    db: DbExecutor,
    idOrSlug: string,
): Promise<LoadedEventRecord | null> {
    const trimmed = idOrSlug.trim();
    if (!trimmed) return null;

    const condition = isUuidString(trimmed)
        ? eq(events.id, trimmed)
        : eq(events.slug, trimmed.toLowerCase());

    const rows = await db
        .select({
            event: events,
            termId: academicTerms.id,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
        })
        .from(events)
        .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
        .where(condition)
        .orderBy(desc(events.createdAt))
        .limit(5);

    if (rows.length === 0) {
        return null;
    }

    const picked = rows.find((r) => r.termStatus === "ACTIVE") ?? rows[0];
    const raw = picked.event;

    const [
        actorMap,
        [committeeRow],
        [taskRow],
        [doneTaskRow],
        [docRow],
        [cpRow],
        [openCpRow],
    ] = await Promise.all([
        loadActorsByIds(db, [raw.createdBy, raw.approvedBy, raw.publishedBy, raw.completedBy]),
        db
            .select({ cnt: count() })
            .from(eventCommittees)
            .where(eq(eventCommittees.eventId, raw.id)),
        db.select({ cnt: count() }).from(tasks).where(eq(tasks.eventId, raw.id)),
        db
            .select({ cnt: count() })
            .from(tasks)
            .where(and(eq(tasks.eventId, raw.id), eq(tasks.status, "DONE"))),
        db.select({ cnt: count() }).from(documents).where(eq(documents.eventId, raw.id)),
        db
            .select({ cnt: count() })
            .from(attendanceCheckpoints)
            .where(eq(attendanceCheckpoints.eventId, raw.id)),
        db
            .select({ cnt: count() })
            .from(attendanceCheckpoints)
            .where(
                and(
                    eq(attendanceCheckpoints.eventId, raw.id),
                    eq(attendanceCheckpoints.status, "OPEN"),
                ),
            ),
    ]);

    return {
        raw,
        termStatus: picked.termStatus,
        dto: {
            id: raw.id,
            slug: raw.slug,
            title: raw.title,
            descriptionHtml: raw.descriptionHtml,
            publicSummary: raw.publicSummary,
            venue: raw.venue,
            targetAudience: raw.targetAudience,
            startAt: raw.startAt.toISOString(),
            endAt: raw.endAt.toISOString(),
            status: raw.status,
            revisionCount: raw.revisionCount,
            academicTerm: {
                id: picked.termId,
                code: picked.termCode,
                name: picked.termName,
                status: picked.termStatus,
            },
            createdBy: actorMap.get(raw.createdBy) ?? null,
            approvedBy: raw.approvedBy ? (actorMap.get(raw.approvedBy) ?? null) : null,
            approvedAt: raw.approvedAt?.toISOString() ?? null,
            publishedBy: raw.publishedBy ? (actorMap.get(raw.publishedBy) ?? null) : null,
            publishedAt: raw.publishedAt?.toISOString() ?? null,
            completedBy: raw.completedBy ? (actorMap.get(raw.completedBy) ?? null) : null,
            completedAt: raw.completedAt?.toISOString() ?? null,
            committeeCount: Number(committeeRow?.cnt ?? 0),
            taskCount: Number(taskRow?.cnt ?? 0),
            completedTaskCount: Number(doneTaskRow?.cnt ?? 0),
            documentCount: Number(docRow?.cnt ?? 0),
            checkpointCount: Number(cpRow?.cnt ?? 0),
            openCheckpointCount: Number(openCpRow?.cnt ?? 0),
            createdAt: raw.createdAt.toISOString(),
            updatedAt: raw.updatedAt.toISOString(),
        },
    };
}

export async function loadEventProposalReviews(
    db: DbExecutor,
    eventId: string,
): Promise<EventProposalReviewDto[]> {
    const rows = await db
        .select({
            id: eventProposalReviews.id,
            eventId: eventProposalReviews.eventId,
            decisionType: eventProposalReviews.decisionType,
            feedbackNote: eventProposalReviews.feedbackNote,
            revisionNumber: eventProposalReviews.revisionNumber,
            createdAt: eventProposalReviews.createdAt,
            reviewerId: users.id,
            reviewerStudentId: users.studentIdNumber,
            reviewerFullName: users.fullName,
            reviewerRole: users.systemRole,
        })
        .from(eventProposalReviews)
        .leftJoin(users, eq(eventProposalReviews.reviewerId, users.id))
        .where(eq(eventProposalReviews.eventId, eventId))
        .orderBy(asc(eventProposalReviews.createdAt));

    return rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        decisionType: row.decisionType,
        feedbackNote: row.feedbackNote,
        revisionNumber: row.revisionNumber,
        reviewer:
            row.reviewerId && row.reviewerStudentId && row.reviewerFullName && row.reviewerRole
                ? {
                      id: row.reviewerId,
                      studentIdNumber: row.reviewerStudentId,
                      fullName: row.reviewerFullName,
                      systemRole: row.reviewerRole,
                  }
                : null,
        createdAt: row.createdAt.toISOString(),
    }));
}

export async function loadEventCommittees(
    db: DbExecutor,
    eventId: string,
    academicTermId: string,
): Promise<EventCommitteeDto[]> {
    const committeeRows = await db
        .select({
            id: eventCommittees.id,
            eventId: eventCommittees.eventId,
            name: eventCommittees.name,
            description: eventCommittees.description,
            headUserId: eventCommittees.headUserId,
            createdAt: eventCommittees.createdAt,
            updatedAt: eventCommittees.updatedAt,
            headStudentId: users.studentIdNumber,
            headFullName: users.fullName,
            headRole: users.systemRole,
            headAccountStatus: users.accountStatus,
        })
        .from(eventCommittees)
        .innerJoin(users, eq(eventCommittees.headUserId, users.id))
        .where(eq(eventCommittees.eventId, eventId))
        .orderBy(asc(eventCommittees.name));

    if (committeeRows.length === 0) {
        return [];
    }

    const committeeIds = committeeRows.map((c) => c.id);

    const [memberRows, taskStatsRows, termAppointments] = await Promise.all([
        db
            .select({
                committeeId: eventCommitteeMembers.committeeId,
                userId: eventCommitteeMembers.userId,
                addedAt: eventCommitteeMembers.addedAt,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
                accountStatus: users.accountStatus,
            })
            .from(eventCommitteeMembers)
            .innerJoin(users, eq(eventCommitteeMembers.userId, users.id))
            .where(inArray(eventCommitteeMembers.committeeId, committeeIds))
            .orderBy(asc(users.fullName)),
        db
            .select({
                committeeId: tasks.committeeId,
                status: tasks.status,
                cnt: count(),
            })
            .from(tasks)
            .where(and(eq(tasks.eventId, eventId), inArray(tasks.committeeId, committeeIds)))
            .groupBy(tasks.committeeId, tasks.status),
        db
            .select({
                userId: officerAppointments.userId,
                positionTitle: officerAppointments.positionTitle,
                isCurrent: officerAppointments.isCurrent,
            })
            .from(officerAppointments)
            .where(eq(officerAppointments.academicTermId, academicTermId)),
    ]);

    const currentApptMap = new Map<string, string>();
    const historicalApptMap = new Map<string, string>();
    for (const appt of termAppointments) {
        if (appt.isCurrent && !currentApptMap.has(appt.userId)) {
            currentApptMap.set(appt.userId, appt.positionTitle);
        }
        if (!historicalApptMap.has(appt.userId)) {
            historicalApptMap.set(appt.userId, appt.positionTitle);
        }
    }

    const membersByCommittee = new Map<string, EventCommitteeDto["members"]>();
    for (const m of memberRows) {
        const list = membersByCommittee.get(m.committeeId) ?? [];
        list.push({
            userId: m.userId,
            studentIdNumber: m.studentIdNumber,
            fullName: m.fullName,
            systemRole: m.systemRole,
            accountStatus: m.accountStatus,
            positionTitle: currentApptMap.get(m.userId) ?? historicalApptMap.get(m.userId) ?? null,
            addedAt: m.addedAt.toISOString(),
        });
        membersByCommittee.set(m.committeeId, list);
    }

    const taskTotals = new Map<string, { total: number; done: number }>();
    for (const row of taskStatsRows) {
        if (!row.committeeId) continue;
        const curr = taskTotals.get(row.committeeId) ?? { total: 0, done: 0 };
        const n = Number(row.cnt);
        curr.total += n;
        if (row.status === "DONE") {
            curr.done += n;
        }
        taskTotals.set(row.committeeId, curr);
    }

    return committeeRows.map((c) => {
        const hasActiveAppointment = currentApptMap.has(c.headUserId);
        const headNeedsReassignment =
            c.headAccountStatus !== "ACTIVE" ||
            c.headRole === "MEMBER" ||
            !hasActiveAppointment;
        const stats = taskTotals.get(c.id) ?? { total: 0, done: 0 };

        return {
            id: c.id,
            eventId: c.eventId,
            name: c.name,
            description: c.description,
            head: {
                id: c.headUserId,
                studentIdNumber: c.headStudentId,
                fullName: c.headFullName,
                systemRole: c.headRole,
                accountStatus: c.headAccountStatus,
                positionTitle:
                    currentApptMap.get(c.headUserId) ?? historicalApptMap.get(c.headUserId) ?? null,
                hasActiveAppointment,
            },
            headNeedsReassignment,
            members: membersByCommittee.get(c.id) ?? [],
            taskTotal: stats.total,
            taskDone: stats.done,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
        };
    });
}

export async function loadEventsPageMeta(db: DbExecutor) {
    const terms = await db
        .select({
            id: academicTerms.id,
            code: academicTerms.code,
            name: academicTerms.name,
            status: academicTerms.status,
        })
        .from(academicTerms)
        .orderBy(desc(academicTerms.startDate));

    const activeTerm = terms.find((t) => t.status === "ACTIVE") ?? null;
    return { terms, activeTerm };
}
