import "server-only";
import {
    and,
    asc,
    count,
    desc,
    eq,
    exists,
    gte,
    ilike,
    inArray,
    isNull,
    lt,
    ne,
    or,
    sql,
    type SQL,
} from "drizzle-orm";
import type { SystemRole } from "@/config/permissions";
import type { DbExecutor } from "@/db";
import {
    academicTerms,
    documents,
    eventCommittees,
    events,
    officerAppointments,
    taskAssignees,
    tasks,
    users,
} from "@/db/schema";
import {
    escapeLikePattern,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
} from "@/lib/admin/audit-logs";
import type { EligibleOfficerOption } from "@/app/api/events/_lib/validation";
import {
    isTaskOverdue,
    type EventTaskProgressSummary,
    type TaskActorSummary,
    type TaskAssigneeDto,
    type TaskDocumentOption,
    type TaskDto,
    type TasksListQuery,
    type TaskWorkspaceCommitteeOption,
    type TaskWorkspaceEventOption,
} from "./validation";

export interface LoadedTaskRecord {
    raw: typeof tasks.$inferSelect;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    eventStatus:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "NEEDS_REVISION"
        | "REJECTED"
        | "APPROVED"
        | "PUBLISHED"
        | "COMPLETED"
        | undefined;
    eventCreatedBy: string | undefined;
    dto: TaskDto;
}

async function loadActorsMap(
    db: DbExecutor,
    ids: Array<string | null | undefined>,
): Promise<Map<string, TaskActorSummary>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    if (unique.length === 0) return new Map();
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

async function hydrateTasksDto(
    db: DbExecutor,
    rows: Array<{
        task: typeof tasks.$inferSelect;
        termId: string;
        termCode: string;
        termName: string;
        termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
        eventId: string | null;
        eventSlug: string | null;
        eventTitle: string | null;
        eventStatus:
            | "DRAFT"
            | "PENDING_REVIEW"
            | "NEEDS_REVISION"
            | "REJECTED"
            | "APPROVED"
            | "PUBLISHED"
            | "COMPLETED"
            | null;
        committeeId: string | null;
        committeeName: string | null;
        committeeHeadUserId: string | null;
        docId: string | null;
        docTitle: string | null;
        docWebViewLink: string | null;
    }>,
): Promise<TaskDto[]> {
    if (rows.length === 0) return [];

    const taskIds = rows.map((r) => r.task.id);
    const [assigneeRows, actorMap] = await Promise.all([
        db
            .select({
                taskId: taskAssignees.taskId,
                userId: taskAssignees.userId,
                assignedAt: taskAssignees.assignedAt,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
            })
            .from(taskAssignees)
            .innerJoin(users, eq(taskAssignees.userId, users.id))
            .where(inArray(taskAssignees.taskId, taskIds))
            .orderBy(asc(users.fullName)),
        loadActorsMap(
            db,
            rows.flatMap((r) => [r.task.createdBy, r.task.completedBy]),
        ),
    ]);

    const assigneesByTask = new Map<string, TaskAssigneeDto[]>();
    for (const a of assigneeRows) {
        const list = assigneesByTask.get(a.taskId) ?? [];
        list.push({
            userId: a.userId,
            studentIdNumber: a.studentIdNumber,
            fullName: a.fullName,
            systemRole: a.systemRole,
            assignedAt: a.assignedAt.toISOString(),
        });
        assigneesByTask.set(a.taskId, list);
    }

    const nowMs = Date.now();
    return rows.map((row) => ({
        id: row.task.id,
        title: row.task.title,
        description: row.task.description,
        status: row.task.status,
        priority: row.task.priority,
        dueAt: row.task.dueAt?.toISOString() ?? null,
        isOverdue: isTaskOverdue(row.task.status, row.task.dueAt, nowMs),
        academicTerm: {
            id: row.termId,
            code: row.termCode,
            name: row.termName,
            status: row.termStatus,
        },
        event:
            row.eventId && row.eventSlug && row.eventTitle && row.eventStatus
                ? {
                      id: row.eventId,
                      slug: row.eventSlug,
                      title: row.eventTitle,
                      status: row.eventStatus,
                  }
                : null,
        committee:
            row.committeeId && row.committeeName && row.committeeHeadUserId
                ? {
                      id: row.committeeId,
                      name: row.committeeName,
                      headUserId: row.committeeHeadUserId,
                  }
                : null,
        linkedDocument:
            row.docId && row.docTitle && row.docWebViewLink
                ? {
                      id: row.docId,
                      title: row.docTitle,
                      webViewLink: row.docWebViewLink,
                  }
                : null,
        assignees: assigneesByTask.get(row.task.id) ?? [],
        createdBy: actorMap.get(row.task.createdBy) ?? null,
        completedBy: row.task.completedBy ? (actorMap.get(row.task.completedBy) ?? null) : null,
        completedAt: row.task.completedAt?.toISOString() ?? null,
        createdAt: row.task.createdAt.toISOString(),
        updatedAt: row.task.updatedAt.toISOString(),
    }));
}

export async function loadTaskDetailById(
    db: DbExecutor,
    taskId: string,
): Promise<LoadedTaskRecord | null> {
    const [row] = await db
        .select({
            task: tasks,
            termId: academicTerms.id,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
            eventId: events.id,
            eventSlug: events.slug,
            eventTitle: events.title,
            eventStatus: events.status,
            eventCreatedBy: events.createdBy,
            committeeId: eventCommittees.id,
            committeeName: eventCommittees.name,
            committeeHeadUserId: eventCommittees.headUserId,
            docId: documents.id,
            docTitle: documents.title,
            docWebViewLink: documents.webViewLink,
        })
        .from(tasks)
        .innerJoin(academicTerms, eq(tasks.academicTermId, academicTerms.id))
        .leftJoin(events, eq(tasks.eventId, events.id))
        .leftJoin(eventCommittees, eq(tasks.committeeId, eventCommittees.id))
        .leftJoin(documents, eq(tasks.linkedDocumentId, documents.id))
        .where(eq(tasks.id, taskId))
        .limit(1);

    if (!row) return null;

    const [dto] = await hydrateTasksDto(db, [row]);
    return {
        raw: row.task,
        termStatus: row.termStatus,
        eventStatus: row.eventStatus ?? undefined,
        eventCreatedBy: row.eventCreatedBy ?? undefined,
        dto,
    };
}

export async function loadEventTaskProgressSummary(
    db: DbExecutor,
    eventId: string,
): Promise<EventTaskProgressSummary> {
    const rows = await db
        .select({
            committeeId: tasks.committeeId,
            status: tasks.status,
            cnt: count(),
        })
        .from(tasks)
        .where(eq(tasks.eventId, eventId))
        .groupBy(tasks.committeeId, tasks.status);

    let taskCount = 0;
    let completedTaskCount = 0;
    const byCommittee: Record<string, { total: number; done: number }> = {};

    for (const row of rows) {
        const n = Number(row.cnt);
        taskCount += n;
        if (row.status === "DONE") {
            completedTaskCount += n;
        }
        if (row.committeeId) {
            const curr = byCommittee[row.committeeId] ?? { total: 0, done: 0 };
            curr.total += n;
            if (row.status === "DONE") {
                curr.done += n;
            }
            byCommittee[row.committeeId] = curr;
        }
    }

    return { taskCount, completedTaskCount, byCommittee };
}

export async function queryTasksList(
    db: DbExecutor,
    actor: { id: string; systemRole: SystemRole },
    query: TasksListQuery,
): Promise<{ items: TaskDto[]; total: number }> {
    const conditions: SQL[] = [];

    // Hide tasks linked to another officer's DRAFT event (BR-EVT-01 defense-in-depth)
    if (actor.systemRole === "OFFICER") {
        const draftGuard = or(
            isNull(tasks.eventId),
            ne(events.status, "DRAFT"),
            eq(events.createdBy, actor.id),
        );
        if (draftGuard) {
            conditions.push(draftGuard);
        }
    }

    if (query.scope === "mine") {
        conditions.push(
            exists(
                db
                    .select({ taskId: taskAssignees.taskId })
                    .from(taskAssignees)
                    .where(
                        and(
                            eq(taskAssignees.taskId, tasks.id),
                            eq(taskAssignees.userId, actor.id),
                        ),
                    ),
            ),
        );
    }

    if (query.termId) {
        conditions.push(eq(tasks.academicTermId, query.termId));
    }

    if (query.eventId) {
        conditions.push(eq(tasks.eventId, query.eventId));
    }

    if (query.committeeId) {
        conditions.push(eq(tasks.committeeId, query.committeeId));
    } else if (query.generalOnly) {
        conditions.push(isNull(tasks.committeeId));
    }

    if (query.status) {
        conditions.push(eq(tasks.status, query.status));
    }

    if (query.priority) {
        conditions.push(eq(tasks.priority, query.priority));
    }

    if (query.assigneeId) {
        conditions.push(
            exists(
                db
                    .select({ taskId: taskAssignees.taskId })
                    .from(taskAssignees)
                    .where(
                        and(
                            eq(taskAssignees.taskId, tasks.id),
                            eq(taskAssignees.userId, query.assigneeId),
                        ),
                    ),
            ),
        );
    }

    if (query.overdueOnly) {
        conditions.push(ne(tasks.status, "DONE"));
        conditions.push(lt(tasks.dueAt, new Date()));
    }

    if (query.q) {
        const pattern = `%${escapeLikePattern(query.q)}%`;
        const searchExpr = or(ilike(tasks.title, pattern), ilike(tasks.description, pattern));
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }

    if (query.dueFrom) {
        conditions.push(gte(tasks.dueAt, manilaDayStartUtc(query.dueFrom)));
    }

    if (query.dueTo) {
        conditions.push(lt(tasks.dueAt, manilaNextDayStartUtc(query.dueTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [{ total }] = await db
        .select({ total: count() })
        .from(tasks)
        .leftJoin(events, eq(tasks.eventId, events.id))
        .where(whereClause);

    const rows = await db
        .select({
            task: tasks,
            termId: academicTerms.id,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
            eventId: events.id,
            eventSlug: events.slug,
            eventTitle: events.title,
            eventStatus: events.status,
            committeeId: eventCommittees.id,
            committeeName: eventCommittees.name,
            committeeHeadUserId: eventCommittees.headUserId,
            docId: documents.id,
            docTitle: documents.title,
            docWebViewLink: documents.webViewLink,
        })
        .from(tasks)
        .innerJoin(academicTerms, eq(tasks.academicTermId, academicTerms.id))
        .leftJoin(events, eq(tasks.eventId, events.id))
        .leftJoin(eventCommittees, eq(tasks.committeeId, eventCommittees.id))
        .leftJoin(documents, eq(tasks.linkedDocumentId, documents.id))
        .where(whereClause)
        .orderBy(
            sql`CASE WHEN ${tasks.status} = 'DONE' THEN 1 ELSE 0 END ASC`,
            sql`${tasks.dueAt} ASC NULLS LAST`,
            desc(tasks.createdAt),
        )
        .limit(query.limit)
        .offset(offset);

    const items = await hydrateTasksDto(db, rows);
    return { items, total: Number(total) };
}

export async function validateActiveTermAssignees(
    db: DbExecutor,
    assigneeIds: string[],
    academicTermId: string,
): Promise<{ ok: true; uniqueIds: string[] } | { ok: false; message: string }> {
    const uniqueIds = Array.from(new Set(assigneeIds));
    if (uniqueIds.length === 0) {
        return { ok: true, uniqueIds: [] };
    }

    const userRows = await db
        .select({
            id: users.id,
            systemRole: users.systemRole,
            accountStatus: users.accountStatus,
        })
        .from(users)
        .where(inArray(users.id, uniqueIds));

    if (userRows.length !== uniqueIds.length) {
        return { ok: false, message: "One or more selected assignees were not found." };
    }

    for (const user of userRows) {
        if (user.accountStatus !== "ACTIVE") {
            return { ok: false, message: "All task assignees must have ACTIVE accounts." };
        }
        if (user.systemRole === "MEMBER") {
            return {
                ok: false,
                message: "General Members cannot be assigned internal operational tasks.",
            };
        }
    }

    const activeAppointments = await db
        .select({ userId: officerAppointments.userId })
        .from(officerAppointments)
        .where(
            and(
                inArray(officerAppointments.userId, uniqueIds),
                eq(officerAppointments.academicTermId, academicTermId),
                eq(officerAppointments.isCurrent, true),
            ),
        );

    const appointedSet = new Set(activeAppointments.map((r) => r.userId));
    const missingAppointment = uniqueIds.filter((id) => !appointedSet.has(id));
    if (missingAppointment.length > 0) {
        return {
            ok: false,
            message:
                "All task assignees must hold an active officer appointment in the target academic term.",
        };
    }

    return { ok: true, uniqueIds };
}

export async function loadTasksWorkspaceMeta(
    db: DbExecutor,
    actorId: string,
): Promise<{
    terms: Array<{ id: string; code: string; name: string; status: "DRAFT" | "ACTIVE" | "CLOSED" }>;
    activeTerm: { id: string; code: string; name: string; status: "DRAFT" | "ACTIVE" | "CLOSED" } | null;
    events: TaskWorkspaceEventOption[];
    committees: TaskWorkspaceCommitteeOption[];
    eligibleOfficers: EligibleOfficerOption[];
    documents: TaskDocumentOption[];
}> {
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

    const [eventRows, committeeRows, officerRows, docRows] = await Promise.all([
        db
            .select({
                id: events.id,
                slug: events.slug,
                title: events.title,
                status: events.status,
                academicTermId: events.academicTermId,
                academicTermCode: academicTerms.code,
                academicTermStatus: academicTerms.status,
            })
            .from(events)
            .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
            .where(inArray(events.status, ["APPROVED", "PUBLISHED", "COMPLETED"]))
            .orderBy(desc(events.startAt))
            .limit(100),
        db
            .select({
                id: eventCommittees.id,
                eventId: eventCommittees.eventId,
                name: eventCommittees.name,
                headUserId: eventCommittees.headUserId,
            })
            .from(eventCommittees)
            .orderBy(asc(eventCommittees.name)),
        activeTerm
            ? db
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
                          eq(officerAppointments.academicTermId, activeTerm.id),
                          eq(officerAppointments.isCurrent, true),
                          eq(users.accountStatus, "ACTIVE"),
                          ne(users.systemRole, "MEMBER"),
                      ),
                  )
                  .orderBy(asc(users.fullName))
            : Promise.resolve([]),
        activeTerm
            ? db
                  .select({
                      id: documents.id,
                      title: documents.title,
                      eventId: documents.eventId,
                  })
                  .from(documents)
                  .where(eq(documents.academicTermId, activeTerm.id))
                  .orderBy(desc(documents.createdAt))
                  .limit(100)
            : Promise.resolve([]),
    ]);

    const seenOfficers = new Set<string>();
    const eligibleOfficers: EligibleOfficerOption[] = [];
    for (const row of officerRows) {
        if (seenOfficers.has(row.userId)) continue;
        seenOfficers.add(row.userId);
        eligibleOfficers.push(row);
    }

    return {
        terms,
        activeTerm,
        events: eventRows,
        committees: committeeRows.map((c) => ({
            ...c,
            isActorHead: c.headUserId === actorId,
        })),
        eligibleOfficers,
        documents: docRows,
    };
}
