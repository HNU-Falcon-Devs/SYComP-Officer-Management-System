"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    ArrowRight,
    CalendarClock,
    CheckCircle2,
    CheckSquare,
    ExternalLink,
    Columns3,
    List,
    Lock,
    Pencil,
    Plus,
    RotateCcw,
    Search,
    ShieldAlert,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import type {
    EligibleOfficerOption,
    EventCommitteeDto,
    EventStatus,
} from "@/app/api/events/_lib/validation";
import {
    TASK_PRIORITIES,
    TASK_STATUSES,
    type EventTaskProgressSummary,
    type TaskDocumentOption,
    type TaskDto,
    type TaskPriority,
    type TaskStatus,
    type TaskWorkspaceCommitteeOption,
} from "@/app/api/tasks/_lib/validation";
import { TaskOverdueBadge, TaskPriorityBadge, TaskStatusBadge } from "@/components/event-hub/task-badges";
import { TaskFormModal } from "@/components/event-hub/task-form-modal";
import { Badge } from "@/components/ui/badge";
import { BreakGlassModal } from "@/components/ui/break-glass-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export interface EventTasksTabProps {
    eventId: string;
    eventStatus: EventStatus;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    committees: EventCommitteeDto[];
    eligibleOfficers: EligibleOfficerOption[];
    actorId: string;
    userRole: SystemRole;
    onTaskStatsChange?: (summary: EventTaskProgressSummary) => void;
}

const COLUMN_LABELS: Record<TaskStatus, string> = {
    TO_DO: "To Do",
    IN_PROGRESS: "In Progress",
    FOR_REVIEW: "For Review",
    DONE: "Done",
};

export function EventTasksTab({
    eventId,
    eventStatus,
    termStatus,
    committees,
    eligibleOfficers,
    actorId,
    userRole,
    onTaskStatsChange,
}: EventTasksTabProps) {
    const isExecutive = userRole === "EXECUTIVE";
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isLocked =
        termStatus === "CLOSED" || eventStatus === "COMPLETED" || eventStatus === "REJECTED";
    const isPreApproval =
        eventStatus === "DRAFT" ||
        eventStatus === "PENDING_REVIEW" ||
        eventStatus === "NEEDS_REVISION";

    const headedCommitteeIds = useMemo(
        () =>
            new Set(
                committees
                    .filter(
                        (c) =>
                            c.head.id === actorId &&
                            c.head.hasActiveAppointment &&
                            c.head.accountStatus === "ACTIVE",
                    )
                    .map((c) => c.id),
            ),
        [actorId, committees],
    );

    const canCreateTask =
        isSuperAdmin ||
        (!isLocked &&
            !isPreApproval &&
            (isExecutive || headedCommitteeIds.size > 0));

    const committeeOptions: TaskWorkspaceCommitteeOption[] = useMemo(
        () =>
            committees.map((c) => ({
                id: c.id,
                eventId,
                name: c.name,
                headUserId: c.head.id,
                isActorHead: headedCommitteeIds.has(c.id),
            })),
        [committees, eventId, headedCommitteeIds],
    );

    const [loading, setLoading] = useState(true);
    const [tasks, setTasks] = useState<TaskDto[]>([]);
    const [eventDocs, setEventDocs] = useState<TaskDocumentOption[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [viewMode, setViewMode] = useState<"list" | "board">("list");
    const [q, setQ] = useState("");
    const [committeeFilter, setCommitteeFilter] = useState("");
    const [assigneeFilter, setAssigneeFilter] = useState("");
    const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
    const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");

    const [formOpen, setFormOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

    const [pendingBg, setPendingBg] = useState<{
        actionLabel: string;
        targetLabel: string;
        run: (reason: string) => Promise<void>;
    } | null>(null);

    const onTaskStatsChangeRef = useRef(onTaskStatsChange);
    useEffect(() => {
        onTaskStatsChangeRef.current = onTaskStatsChange;
    }, [onTaskStatsChange]);

    useEffect(() => {
        let cancelled = false;
        async function loadInitial() {
            try {
                const [tasksRes, docsRes] = await Promise.all([
                    fetch(
                        `${ROUTES.api.tasks}?${new URLSearchParams({
                            eventId,
                            limit: "100",
                        }).toString()}`,
                    ),
                    fetch(
                        `${ROUTES.api.documents}?${new URLSearchParams({
                            eventId,
                            limit: "50",
                        }).toString()}`,
                    ),
                ]);
                if (cancelled) return;

                const tasksPayload = (await tasksRes.json()) as {
                    data?: {
                        items: TaskDto[];
                        eventSummary?: EventTaskProgressSummary;
                    };
                    error?: { message?: string };
                };
                if (!cancelled) {
                    if (!tasksRes.ok || !tasksPayload.data) {
                        setErrorMsg(tasksPayload.error?.message ?? "Failed to load event tasks.");
                    } else {
                        setTasks(tasksPayload.data.items);
                        if (tasksPayload.data.eventSummary) {
                            onTaskStatsChangeRef.current?.(tasksPayload.data.eventSummary);
                        }
                    }
                }

                if (docsRes.ok) {
                    const docsPayload = (await docsRes.json()) as {
                        data?: {
                            items: Array<{
                                id: string;
                                title: string;
                                event: { id: string } | null;
                            }>;
                        };
                    };
                    if (!cancelled && docsPayload.data) {
                        setEventDocs(
                            docsPayload.data.items.map((d) => ({
                                id: d.id,
                                title: d.title,
                                eventId: d.event?.id ?? null,
                            })),
                        );
                    }
                }
            } catch {
                if (!cancelled) {
                    setErrorMsg("Network error while loading event tasks.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        void loadInitial();
        return () => {
            cancelled = true;
        };
    }, [eventId]);

    const filteredTasks = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return tasks.filter((task) => {
            if (committeeFilter === "__event_wide__" && task.committee !== null) return false;
            if (
                committeeFilter &&
                committeeFilter !== "__event_wide__" &&
                task.committee?.id !== committeeFilter
            ) {
                return false;
            }
            if (assigneeFilter && !task.assignees.some((a) => a.userId === assigneeFilter)) {
                return false;
            }
            if (priorityFilter && task.priority !== priorityFilter) return false;
            if (statusFilter && task.status !== statusFilter) return false;
            if (needle) {
                const inTitle = task.title.toLowerCase().includes(needle);
                const inDesc = (task.description ?? "").toLowerCase().includes(needle);
                if (!inTitle && !inDesc) return false;
            }
            return true;
        });
    }, [assigneeFilter, committeeFilter, priorityFilter, q, statusFilter, tasks]);

    async function runStatusUpdate(
        task: TaskDto,
        nextStatus: TaskStatus,
        breakGlassReason?: string,
    ) {
        setErrorMsg(null);
        setBusyTaskId(task.id);
        try {
            const res = await fetch(`${ROUTES.api.tasks}/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    ...(breakGlassReason
                        ? { breakGlass: true, reason: breakGlassReason }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { task: TaskDto; eventSummary?: EventTaskProgressSummary };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.task) {
                setErrorMsg(payload.error?.message ?? "Failed to update task status.");
                return;
            }
            setTasks((prev) =>
                prev.map((t) => (t.id === task.id ? payload.data!.task : t)),
            );
            if (payload.data.eventSummary) {
                onTaskStatsChange?.(payload.data.eventSummary);
            }
            setPendingBg(null);
            toast.success(`Task moved to ${COLUMN_LABELS[nextStatus]}.`);
        } catch {
            setErrorMsg("Network error while updating task status.");
        } finally {
            setBusyTaskId(null);
        }
    }

    async function runDelete(task: TaskDto, breakGlassReason?: string) {
        setErrorMsg(null);
        setBusyTaskId(task.id);
        try {
            const res = await fetch(`${ROUTES.api.tasks}/${task.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    breakGlassReason ? { breakGlass: true, reason: breakGlassReason } : {},
                ),
            });
            const payload = (await res.json()) as {
                data?: { deletedTaskId: string; eventSummary?: EventTaskProgressSummary };
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to delete task.");
                return;
            }
            setTasks((prev) => prev.filter((t) => t.id !== task.id));
            if (payload.data?.eventSummary) {
                onTaskStatsChange?.(payload.data.eventSummary);
            }
            setPendingBg(null);
            toast.success("Task removed.");
        } catch {
            setErrorMsg("Network error while deleting task.");
        } finally {
            setBusyTaskId(null);
        }
    }

    function requestStatusChange(task: TaskDto, nextStatus: TaskStatus) {
        if (isSuperAdmin) {
            setPendingBg({
                actionLabel: nextStatus === "DONE" ? "TASK_COMPLETED" : "TASK_STATUS_UPDATED",
                targetLabel: `${task.title} -> ${COLUMN_LABELS[nextStatus]}`,
                run: (reason) => runStatusUpdate(task, nextStatus, reason),
            });
            return;
        }
        void runStatusUpdate(task, nextStatus);
    }

    function requestDelete(task: TaskDto) {
        if (isSuperAdmin) {
            setPendingBg({
                actionLabel: "TASK_DELETED",
                targetLabel: task.title,
                run: (reason) => runDelete(task, reason),
            });
            return;
        }
        if (!window.confirm(`Delete task "${task.title}"? This action is recorded in audit logs.`)) {
            return;
        }
        void runDelete(task);
    }

    function getTaskActions(task: TaskDto) {
        const isOwnCommitteeHead = Boolean(
            task.committee && headedCommitteeIds.has(task.committee.id),
        );
        const canManage = isSuperAdmin || (!isLocked && (isExecutive || isOwnCommitteeHead));
        const isAssigned = task.assignees.some((a) => a.userId === actorId);
        const canProgress = canManage || (!isLocked && isAssigned);
        return { canManage, canProgress };
    }

    if (isPreApproval) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <Lock className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                        Event tasks unlock once this proposal is APPROVED.
                    </p>
                    <p className="max-w-md text-xs text-muted-foreground">
                        Executives and assigned Committee Heads can track deliverables here after
                        proposal approval (BR-TSK-01).
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    function renderTaskActionControls(task: TaskDto) {
        const { canManage, canProgress } = getTaskActions(task);
        const busy = busyTaskId === task.id;

        return (
            <div className="flex flex-wrap items-center gap-1.5">
                {canProgress && task.status === "TO_DO" ? (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => requestStatusChange(task, "IN_PROGRESS")}
                    >
                        <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Start</span>
                    </Button>
                ) : null}
                {canProgress && task.status === "IN_PROGRESS" ? (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => requestStatusChange(task, "FOR_REVIEW")}
                    >
                        <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Submit for Review</span>
                    </Button>
                ) : null}
                {canManage && task.status === "FOR_REVIEW" ? (
                    <>
                        <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => requestStatusChange(task, "DONE")}
                        >
                            <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Mark Done</span>
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => requestStatusChange(task, "IN_PROGRESS")}
                        >
                            <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Return</span>
                        </Button>
                    </>
                ) : null}
                {canManage && task.status !== "DONE" && task.status !== "FOR_REVIEW" ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => requestStatusChange(task, "DONE")}
                    >
                        <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Done</span>
                    </Button>
                ) : null}
                {canManage && task.status === "DONE" ? (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => requestStatusChange(task, "IN_PROGRESS")}
                    >
                        <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Reopen</span>
                    </Button>
                ) : null}
                {canManage ? (
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={`Edit ${task.title}`}
                            onClick={() => {
                                setEditingTask(task);
                                setFormOpen(true);
                            }}
                        >
                            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={`Delete ${task.title}`}
                            onClick={() => requestDelete(task)}
                        >
                            <Trash2
                                className="size-4 text-destructive"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                        </Button>
                    </>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            {errorMsg ? (
                <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm font-medium text-destructive"
                >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>{errorMsg}</span>
                </div>
            ) : null}

            {isLocked && !isSuperAdmin ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>
                        Tasks are frozen in their final state because this event or academic term is
                        finalized (BR-TSK-03).
                    </span>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Event Tasks &amp; Deliverables</h2>
                    <p className="text-xs text-muted-foreground">
                        {tasks.filter((t) => t.status === "DONE").length} of {tasks.length}{" "}
                        completed across committees &amp; event-wide work.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-xs">
                        <button
                            type="button"
                            onClick={() => setViewMode("list")}
                            className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 font-medium sm:min-h-8 ${
                                viewMode === "list"
                                    ? "bg-card text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <List className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>List</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("board")}
                            className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 font-medium sm:min-h-8 ${
                                viewMode === "board"
                                    ? "bg-card text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Columns3 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Board</span>
                        </button>
                    </div>

                    {canCreateTask ? (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setEditingTask(null);
                                setFormOpen(true);
                            }}
                        >
                            {isSuperAdmin ? (
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            )}
                            <span>{isSuperAdmin ? "Add Task (Break-Glass)" : "Add Task"}</span>
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3.5 md:grid-cols-5">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                        strokeWidth={1.75}
                        aria-hidden="true"
                    />
                    <Input
                        aria-label="Search event tasks"
                        placeholder="Search tasks..."
                        className="pl-9"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
                <select
                    aria-label="Filter by committee"
                    value={committeeFilter}
                    onChange={(e) => setCommitteeFilter(e.target.value)}
                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                >
                    <option value="">All Scopes</option>
                    <option value="__event_wide__">Event-Wide Only</option>
                    {committees.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter by assignee"
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                >
                    <option value="">All Assignees</option>
                    {eligibleOfficers.map((o) => (
                        <option key={o.userId} value={o.userId}>
                            {o.fullName}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter by priority"
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")}
                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                >
                    <option value="">All Priorities</option>
                    {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                            {p}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter by status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}
                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                >
                    <option value="">All Statuses</option>
                    {TASK_STATUSES.map((st) => (
                        <option key={st} value={st}>
                            {COLUMN_LABELS[st]}
                        </option>
                    ))}
                </select>
            </div>

            {filteredTasks.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <CheckSquare
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            {tasks.length === 0
                                ? "No deliverables have been created for this event yet."
                                : "No tasks match the selected filters."}
                        </p>
                    </CardContent>
                </Card>
            ) : viewMode === "list" ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <ul className="divide-y divide-border">
                        {filteredTasks.map((task) => (
                            <li
                                key={task.id}
                                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground">
                                            {task.title}
                                        </span>
                                        <TaskStatusBadge status={task.status} />
                                        <TaskPriorityBadge priority={task.priority} />
                                        {task.isOverdue ? <TaskOverdueBadge /> : null}
                                        <Badge variant="neutral">
                                            {task.committee ? task.committee.name : "Event-Wide"}
                                        </Badge>
                                    </div>
                                    {task.description ? (
                                        <p className="mt-1.5 max-w-3xl text-xs text-muted-foreground">
                                            {task.description}
                                        </p>
                                    ) : null}
                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                        {task.dueAt ? (
                                            <span className="inline-flex items-center gap-1 font-mono">
                                                <CalendarClock
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                Due {formatManilaTimestamp(task.dueAt)}
                                            </span>
                                        ) : null}
                                        <span>
                                            Assignees:{" "}
                                            {task.assignees.length > 0
                                                ? task.assignees.map((a) => a.fullName).join(", ")
                                                : "Unassigned"}
                                        </span>
                                        {task.linkedDocument ? (
                                            <a
                                                href={task.linkedDocument.webViewLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 font-medium text-primary hover:underline dark:text-brand-accent"
                                            >
                                                <span>{task.linkedDocument.title}</span>
                                                <ExternalLink
                                                    className="size-3"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="shrink-0">{renderTaskActionControls(task)}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {TASK_STATUSES.map((colStatus) => {
                        const colItems = filteredTasks.filter((t) => t.status === colStatus);
                        return (
                            <div
                                key={colStatus}
                                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <TaskStatusBadge status={colStatus} />
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {colItems.length}
                                    </span>
                                </div>
                                {colItems.length === 0 ? (
                                    <p className="py-6 text-center text-xs text-muted-foreground">
                                        Empty
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2.5">
                                        {colItems.map((task) => (
                                            <div
                                                key={task.id}
                                                className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
                                            >
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <TaskPriorityBadge priority={task.priority} />
                                                    {task.isOverdue ? <TaskOverdueBadge /> : null}
                                                </div>
                                                <p className="text-sm font-medium text-foreground">
                                                    {task.title}
                                                </p>
                                                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                                    <span>
                                                        {task.committee
                                                            ? task.committee.name
                                                            : "Event-Wide"}
                                                    </span>
                                                    {task.dueAt ? (
                                                        <span className="font-mono">
                                                            {formatManilaTimestamp(task.dueAt)}
                                                        </span>
                                                    ) : null}
                                                    {task.assignees.length > 0 ? (
                                                        <span className="truncate">
                                                            {task.assignees
                                                                .map((a) => a.fullName)
                                                                .join(", ")}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="border-t border-border pt-2">
                                                    {renderTaskActionControls(task)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <TaskFormModal
                open={formOpen}
                userRole={userRole}
                initialTask={editingTask}
                lockedEventId={eventId}
                committees={committeeOptions}
                eligibleOfficers={eligibleOfficers}
                documents={eventDocs}
                onClose={() => {
                    setFormOpen(false);
                    setEditingTask(null);
                }}
                onSaved={(saved, eventSummary) => {
                    setFormOpen(false);
                    setEditingTask(null);
                    setTasks((prev) => {
                        const exists = prev.some((t) => t.id === saved.id);
                        return exists
                            ? prev.map((t) => (t.id === saved.id ? saved : t))
                            : [saved, ...prev];
                    });
                    if (eventSummary) {
                        onTaskStatsChange?.(eventSummary);
                    }
                }}
            />

            <BreakGlassModal
                open={Boolean(pendingBg)}
                actionLabel={pendingBg?.actionLabel ?? ""}
                targetLabel={pendingBg?.targetLabel ?? ""}
                submitting={Boolean(busyTaskId)}
                onCancel={() => setPendingBg(null)}
                onConfirm={(reason) => pendingBg?.run(reason)}
            />
        </div>
    );
}
