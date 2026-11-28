import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
    academicTerms,
    documents,
    eventCommittees,
    events,
    taskAssignees,
    tasks,
} from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import {
    loadEventTaskProgressSummary,
    loadTaskDetailById,
    queryTasksList,
    validateActiveTermAssignees,
} from "./_lib/queries";
import {
    createTaskSchema,
    isPgForeignKeyViolation,
    parseTasksSearchParams,
    TASK_ELIGIBLE_EVENT_STATUSES,
    tasksListQuerySchema,
} from "./_lib/validation";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "event:workspace:view",
            {},
            deps,
        );

        const url = new URL(request.url);
        const query = tasksListQuerySchema.parse(parseTasksSearchParams(url.searchParams));

        const [listResult, eventSummary] = await Promise.all([
            queryTasksList(db, actor, query),
            query.eventId
                ? loadEventTaskProgressSummary(db, query.eventId)
                : Promise.resolve(null),
        ]);

        return apiJson(
            {
                items: listResult.items,
                pagination: {
                    page: query.page,
                    limit: query.limit,
                    total: listResult.total,
                },
                ...(eventSummary ? { eventSummary } : {}),
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        // Enforce base Layer 0/1 workspace access BEFORE parsing body or querying DB
        await authorize({ actor: session?.user ?? null }, "event:workspace:view", {}, deps);

        const body = await request.json().catch(() => null);
        const input = createTaskSchema.parse(body);

        let academicTermId: string;
        let termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
        let eventStatus:
            | "DRAFT"
            | "PENDING_REVIEW"
            | "NEEDS_REVISION"
            | "REJECTED"
            | "APPROVED"
            | "PUBLISHED"
            | "COMPLETED"
            | undefined;

        if (input.eventId) {
            const [ev] = await db
                .select({
                    id: events.id,
                    status: events.status,
                    academicTermId: events.academicTermId,
                    termStatus: academicTerms.status,
                })
                .from(events)
                .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
                .where(eq(events.id, input.eventId))
                .limit(1);

            if (!ev) {
                await authorize(
                    {
                        actor: session?.user ?? null,
                        breakGlass: input.breakGlass,
                        reason: input.reason,
                    },
                    input.committeeId ? "task:committee:manage" : "task:general:manage",
                    {},
                    deps,
                );
                return apiError(404, "EVENT_NOT_FOUND", "Target event was not found.");
            }

            academicTermId = ev.academicTermId;
            termStatus = ev.termStatus;
            eventStatus = ev.status;

            if (input.committeeId) {
                const [committee] = await db
                    .select({ id: eventCommittees.id })
                    .from(eventCommittees)
                    .where(
                        and(
                            eq(eventCommittees.id, input.committeeId),
                            eq(eventCommittees.eventId, ev.id),
                        ),
                    )
                    .limit(1);

                if (!committee) {
                    await authorize(
                        {
                            actor: session?.user ?? null,
                            breakGlass: input.breakGlass,
                            reason: input.reason,
                        },
                        "task:committee:manage",
                        {
                            termStatus,
                            eventStatus,
                            academicTermId,
                            eventId: ev.id,
                            committeeId: input.committeeId,
                        },
                        deps,
                    );
                    return apiError(
                        404,
                        "COMMITTEE_NOT_FOUND",
                        "Committee does not belong to the specified event.",
                    );
                }
            }
        } else {
            const [activeTerm] = await db
                .select({ id: academicTerms.id, status: academicTerms.status })
                .from(academicTerms)
                .where(eq(academicTerms.status, "ACTIVE"))
                .limit(1);

            if (!activeTerm) {
                await authorize(
                    {
                        actor: session?.user ?? null,
                        breakGlass: input.breakGlass,
                        reason: input.reason,
                    },
                    "task:general:manage",
                    {},
                    deps,
                );
                return apiError(
                    409,
                    "NO_ACTIVE_TERM",
                    "An ACTIVE academic term is required before creating organizational tasks.",
                );
            }

            academicTermId = activeTerm.id;
            termStatus = activeTerm.status;
        }

        const permission = input.committeeId ? "task:committee:manage" : "task:general:manage";
        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            permission,
            {
                termStatus,
                eventStatus,
                academicTermId,
                eventId: input.eventId ?? undefined,
                committeeId: input.committeeId ?? undefined,
            },
            deps,
        );

        if (eventStatus && !TASK_ELIGIBLE_EVENT_STATUSES.has(eventStatus) && !isBreakGlass) {
            return apiError(
                409,
                "EVENT_NOT_APPROVED",
                "Event tasks can only be created once the event proposal is APPROVED or PUBLISHED.",
            );
        }

        const assigneeCheck = await validateActiveTermAssignees(
            db,
            input.assigneeIds,
            academicTermId,
        );
        if (!assigneeCheck.ok) {
            return apiError(400, "INVALID_TASK_ASSIGNEE", assigneeCheck.message);
        }

        if (input.linkedDocumentId) {
            const [doc] = await db
                .select({ id: documents.id })
                .from(documents)
                .where(eq(documents.id, input.linkedDocumentId))
                .limit(1);
            if (!doc) {
                return apiError(400, "INVALID_LINKED_DOCUMENT", "Linked document was not found.");
            }
        }

        const dueAt = input.dueAt ? new Date(input.dueAt) : null;
        const now = new Date();
        const ip = getClientIp(request);

        const createdId = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(tasks)
                .values({
                    academicTermId,
                    eventId: input.eventId ?? null,
                    committeeId: input.committeeId ?? null,
                    title: input.title,
                    description: input.description ?? null,
                    status: "TO_DO",
                    priority: input.priority,
                    dueAt,
                    linkedDocumentId: input.linkedDocumentId ?? null,
                    createdBy: actor.id,
                    completedBy: null,
                    completedAt: null,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: tasks.id });

            if (assigneeCheck.uniqueIds.length > 0) {
                await tx.insert(taskAssignees).values(
                    assigneeCheck.uniqueIds.map((userId) => ({
                        taskId: inserted.id,
                        userId,
                        assignedBy: actor.id,
                        assignedAt: now,
                    })),
                );
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "TASK_CREATED",
                entityType: "task",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    academicTermId,
                    eventId: input.eventId ?? null,
                    committeeId: input.committeeId ?? null,
                    title: input.title,
                    status: "TO_DO",
                    priority: input.priority,
                    dueAt: dueAt?.toISOString() ?? null,
                    linkedDocumentId: input.linkedDocumentId ?? null,
                    assigneeIds: assigneeCheck.uniqueIds,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        const [loaded, eventSummary] = await Promise.all([
            loadTaskDetailById(db, createdId),
            input.eventId
                ? loadEventTaskProgressSummary(db, input.eventId)
                : Promise.resolve(null),
        ]);

        return apiJson(
            {
                task: loaded?.dto,
                ...(eventSummary ? { eventSummary } : {}),
            },
            201,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (isPgForeignKeyViolation(error)) {
            return apiError(
                400,
                "INVALID_TASK_REFERENCE",
                "Referenced event, committee, assignee, or document is invalid.",
            );
        }
        return apiErrorResponse(error);
    }
}
