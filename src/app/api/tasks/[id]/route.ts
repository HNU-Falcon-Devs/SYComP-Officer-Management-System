import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Permission } from "@/config/permissions";
import { getDb } from "@/db";
import { documents, eventCommittees, taskAssignees, tasks } from "@/db/schema";
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
    validateActiveTermAssignees,
} from "../_lib/queries";
import {
    deleteTaskSchema,
    isPgForeignKeyViolation,
    isReviewerOnlyStatusTransition,
    updateTaskSchema,
    type TaskStatus,
} from "../_lib/validation";

const uuidSchema = z.string().uuid("Invalid task ID.");

function resolveTaskPatchAuditAction(
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    hasMetadataChange: boolean,
): string {
    if (toStatus !== fromStatus) {
        if (toStatus === "DONE") return "TASK_COMPLETED";
        if (fromStatus === "DONE" || (fromStatus === "FOR_REVIEW" && toStatus !== "FOR_REVIEW")) {
            return "TASK_REOPENED";
        }
        if (!hasMetadataChange) return "TASK_STATUS_UPDATED";
    }
    return "TASK_UPDATED";
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        await authorize({ actor: session?.user ?? null }, "event:workspace:view", {}, deps);

        const { id } = await context.params;
        const taskId = uuidSchema.parse(id);

        const loaded = await loadTaskDetailById(db, taskId);
        if (!loaded) {
            return apiError(404, "TASK_NOT_FOUND", "Task not found.");
        }

        if (loaded.eventStatus === "DRAFT" && loaded.eventCreatedBy) {
            await authorize(
                { actor: session?.user ?? null },
                "event:draft:view",
                {
                    ownerUserId: loaded.eventCreatedBy,
                    eventId: loaded.raw.eventId ?? undefined,
                },
                deps,
            );
        }

        return apiJson({ task: loaded.dto }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        // Enforce Layer 0/1 workspace access BEFORE payload parsing or DB lookups
        const baseAuth = await authorize(
            { actor: session?.user ?? null },
            "event:workspace:view",
            {},
            deps,
        );

        const { id } = await context.params;
        const taskId = uuidSchema.parse(id);
        const body = await request.json().catch(() => null);
        const input = updateTaskSchema.parse(body);

        const loaded = await loadTaskDetailById(db, taskId);
        if (!loaded) {
            return apiError(404, "TASK_NOT_FOUND", "Task not found.");
        }

        const existing = loaded.raw;
        const hasMetadataFields =
            input.title !== undefined ||
            input.description !== undefined ||
            input.priority !== undefined ||
            input.dueAt !== undefined ||
            input.committeeId !== undefined ||
            input.linkedDocumentId !== undefined ||
            input.assigneeIds !== undefined;

        const nextCommitteeId =
            input.committeeId === undefined ? existing.committeeId : input.committeeId;
        const committeeChanged = nextCommitteeId !== existing.committeeId;

        const nextStatus = input.status ?? existing.status;
        const statusChanged = nextStatus !== existing.status;
        const reviewerStatusChange =
            statusChanged && isReviewerOnlyStatusTransition(existing.status, nextStatus);

        let requiredPermission: Permission;
        if (committeeChanged) {
            // Re-scoping a task across committees or to/from Event-Wide is Executive-only
            requiredPermission = "task:general:manage";
        } else if (hasMetadataFields) {
            requiredPermission = existing.committeeId
                ? "task:committee:manage"
                : "task:general:manage";
        } else if (reviewerStatusChange) {
            requiredPermission = existing.committeeId
                ? "task:review:complete"
                : "task:general:manage";
        } else if (
            baseAuth.actor.systemRole === "OFFICER" &&
            existing.committeeId &&
            deps.isCommitteeHead &&
            (await deps.isCommitteeHead(
                baseAuth.actor.id,
                existing.committeeId,
                existing.academicTermId,
            ))
        ) {
            requiredPermission = "task:committee:manage";
        } else {
            requiredPermission = "task:assignee:progress";
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            requiredPermission,
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.eventStatus,
                academicTermId: existing.academicTermId,
                eventId: existing.eventId ?? undefined,
                committeeId: existing.committeeId ?? undefined,
                taskId: existing.id,
            },
            deps,
        );

        if (committeeChanged && nextCommitteeId !== null) {
            if (!existing.eventId) {
                return apiError(
                    400,
                    "INVALID_COMMITTEE_SCOPE",
                    "General organizational tasks cannot be assigned to an event committee.",
                );
            }
            const [targetCommittee] = await db
                .select({ id: eventCommittees.id })
                .from(eventCommittees)
                .where(
                    and(
                        eq(eventCommittees.id, nextCommitteeId),
                        eq(eventCommittees.eventId, existing.eventId),
                    ),
                )
                .limit(1);
            if (!targetCommittee) {
                return apiError(
                    400,
                    "INVALID_COMMITTEE_SCOPE",
                    "Target committee does not belong to this task's parent event.",
                );
            }
        }

        let validatedAssignees: string[] | undefined;
        if (input.assigneeIds !== undefined) {
            const check = await validateActiveTermAssignees(
                db,
                input.assigneeIds,
                existing.academicTermId,
            );
            if (!check.ok) {
                return apiError(400, "INVALID_TASK_ASSIGNEE", check.message);
            }
            validatedAssignees = check.uniqueIds;
        }

        if (input.linkedDocumentId !== undefined && input.linkedDocumentId !== null) {
            const [doc] = await db
                .select({ id: documents.id })
                .from(documents)
                .where(eq(documents.id, input.linkedDocumentId))
                .limit(1);
            if (!doc) {
                return apiError(400, "INVALID_LINKED_DOCUMENT", "Linked document was not found.");
            }
        }

        const now = new Date();
        const ip = getClientIp(request);

        const nextTitle = input.title ?? existing.title;
        const nextDescription =
            input.description === undefined ? existing.description : input.description;
        const nextPriority = input.priority ?? existing.priority;
        const nextDueAt =
            input.dueAt === undefined
                ? existing.dueAt
                : input.dueAt === null
                  ? null
                  : new Date(input.dueAt);
        const nextLinkedDocId =
            input.linkedDocumentId === undefined
                ? existing.linkedDocumentId
                : input.linkedDocumentId;

        // Enforce tasks_completed_pair_chk: completedBy and completedAt always set/cleared together
        const nextCompletedBy =
            nextStatus === "DONE"
                ? existing.status === "DONE"
                    ? existing.completedBy
                    : actor.id
                : null;
        const nextCompletedAt =
            nextStatus === "DONE"
                ? existing.status === "DONE"
                    ? existing.completedAt
                    : now
                : null;

        const prevAssigneeIds = loaded.dto.assignees.map((a) => a.userId).sort();
        const nextAssigneeIdsSorted =
            validatedAssignees !== undefined ? [...validatedAssignees].sort() : prevAssigneeIds;
        const assigneesChanged =
            validatedAssignees !== undefined &&
            JSON.stringify(prevAssigneeIds) !== JSON.stringify(nextAssigneeIdsSorted);

        const changed =
            nextTitle !== existing.title ||
            nextDescription !== existing.description ||
            nextStatus !== existing.status ||
            nextPriority !== existing.priority ||
            (nextDueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null) ||
            nextCommitteeId !== existing.committeeId ||
            nextLinkedDocId !== existing.linkedDocumentId ||
            assigneesChanged;

        if (!changed) {
            const eventSummary = existing.eventId
                ? await loadEventTaskProgressSummary(db, existing.eventId)
                : null;
            return apiJson(
                { task: loaded.dto, ...(eventSummary ? { eventSummary } : {}) },
                200,
                { "Cache-Control": "no-store" },
            );
        }

        await db.transaction(async (tx) => {
            await tx
                .update(tasks)
                .set({
                    title: nextTitle,
                    description: nextDescription,
                    status: nextStatus,
                    priority: nextPriority,
                    dueAt: nextDueAt,
                    committeeId: nextCommitteeId,
                    linkedDocumentId: nextLinkedDocId,
                    completedBy: nextCompletedBy,
                    completedAt: nextCompletedAt,
                    updatedAt: now,
                })
                .where(eq(tasks.id, existing.id));

            if (assigneesChanged && validatedAssignees !== undefined) {
                await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, existing.id));
                if (validatedAssignees.length > 0) {
                    await tx.insert(taskAssignees).values(
                        validatedAssignees.map((userId) => ({
                            taskId: existing.id,
                            userId,
                            assignedBy: actor.id,
                            assignedAt: now,
                        })),
                    );
                }
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: resolveTaskPatchAuditAction(
                    existing.status,
                    nextStatus,
                    hasMetadataFields,
                ),
                entityType: "task",
                entityId: existing.id,
                beforeState: {
                    title: existing.title,
                    status: existing.status,
                    priority: existing.priority,
                    dueAt: existing.dueAt?.toISOString() ?? null,
                    committeeId: existing.committeeId,
                    linkedDocumentId: existing.linkedDocumentId,
                    assigneeIds: prevAssigneeIds,
                    completedBy: existing.completedBy,
                    completedAt: existing.completedAt?.toISOString() ?? null,
                },
                afterState: {
                    title: nextTitle,
                    status: nextStatus,
                    priority: nextPriority,
                    dueAt: nextDueAt?.toISOString() ?? null,
                    committeeId: nextCommitteeId,
                    linkedDocumentId: nextLinkedDocId,
                    assigneeIds: nextAssigneeIdsSorted,
                    completedBy: nextCompletedBy,
                    completedAt: nextCompletedAt?.toISOString() ?? null,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const [refreshed, eventSummary] = await Promise.all([
            loadTaskDetailById(db, existing.id),
            existing.eventId
                ? loadEventTaskProgressSummary(db, existing.eventId)
                : Promise.resolve(null),
        ]);

        return apiJson(
            {
                task: refreshed?.dto ?? loaded.dto,
                ...(eventSummary ? { eventSummary } : {}),
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (isPgForeignKeyViolation(error)) {
            return apiError(
                400,
                "INVALID_TASK_REFERENCE",
                "Referenced committee, assignee, or document is invalid.",
            );
        }
        return apiErrorResponse(error);
    }
}

export async function DELETE(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        await authorize({ actor: session?.user ?? null }, "event:workspace:view", {}, deps);

        const { id } = await context.params;
        const taskId = uuidSchema.parse(id);

        const rawBody = await request.json().catch(() => ({}));
        const input = deleteTaskSchema.parse(rawBody ?? {});

        const loaded = await loadTaskDetailById(db, taskId);
        if (!loaded) {
            return apiError(404, "TASK_NOT_FOUND", "Task not found.");
        }

        const existing = loaded.raw;
        const permission: Permission = existing.committeeId
            ? "task:committee:manage"
            : "task:general:manage";

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            permission,
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.eventStatus,
                academicTermId: existing.academicTermId,
                eventId: existing.eventId ?? undefined,
                committeeId: existing.committeeId ?? undefined,
                taskId: existing.id,
            },
            deps,
        );

        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            await tx.delete(tasks).where(eq(tasks.id, existing.id));

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "TASK_DELETED",
                entityType: "task",
                entityId: existing.id,
                beforeState: {
                    title: existing.title,
                    status: existing.status,
                    priority: existing.priority,
                    eventId: existing.eventId,
                    committeeId: existing.committeeId,
                    assigneeIds: loaded.dto.assignees.map((a) => a.userId),
                },
                afterState: null,
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const eventSummary = existing.eventId
            ? await loadEventTaskProgressSummary(db, existing.eventId)
            : null;

        return apiJson(
            {
                deletedTaskId: existing.id,
                ...(eventSummary ? { eventSummary } : {}),
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
