"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
    AlertCircle,
    ArrowRight,
    CalendarClock,
    CheckCircle2,
    CheckSquare,
    ChevronLeft,
    ChevronRight,
    ClockAlert,
    Columns3,
    ExternalLink,
    Eye,
    List,
    Loader2,
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
import type { EligibleOfficerOption } from "@/app/api/events/_lib/validation";
import {
    TASK_PRIORITIES,
    TASK_STATUSES,
    TASKS_DEFAULT_LIMIT,
    type TaskDocumentOption,
    type TaskDto,
    type TaskPriority,
    type TaskStatus,
    type TaskWorkspaceCommitteeOption,
    type TaskWorkspaceEventOption,
} from "@/app/api/tasks/_lib/validation";
import {
    TaskOverdueBadge,
    TaskPriorityBadge,
    TaskStatusBadge,
} from "@/components/event-hub/task-badges";
import { TaskFormModal } from "@/components/event-hub/task-form-modal";
import { Badge } from "@/components/ui/badge";
import { BreakGlassModal } from "@/components/ui/break-glass-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface TermOption {
    id: string;
    code: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
}

export interface TasksWorkspaceProps {
    actorId: string;
    userRole: SystemRole;
    defaultScope: "mine" | "all";
    initialItems: TaskDto[];
    initialTotal: number;
    terms: TermOption[];
    activeTerm: TermOption | null;
    events: TaskWorkspaceEventOption[];
    committees: TaskWorkspaceCommitteeOption[];
    eligibleOfficers: EligibleOfficerOption[];
    documents: TaskDocumentOption[];
}

const STATUS_LABELS: Record<TaskStatus, string> = {
    TO_DO: "To Do",
    IN_PROGRESS: "In Progress",
    FOR_REVIEW: "For Review",
    DONE: "Done",
};

export function TasksWorkspace({
    actorId,
    userRole,
    defaultScope,
    initialItems,
    initialTotal,
    terms,
    activeTerm,
    events,
    committees,
    eligibleOfficers,
    documents,
}: TasksWorkspaceProps) {
    const isExecutive = userRole === "EXECUTIVE";
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    const headedCommitteeIds = useMemo(
        () => new Set(committees.filter((c) => c.isActorHead).map((c) => c.id)),
        [committees],
    );

    const hasCreatableHeadCommittee = useMemo(() => {
        const activeEventIds = new Set(
            events
                .filter(
                    (ev) =>
                        (ev.status === "APPROVED" || ev.status === "PUBLISHED") &&
                        ev.academicTermStatus !== "CLOSED",
                )
                .map((ev) => ev.id),
        );
        return committees.some((c) => c.isActorHead && activeEventIds.has(c.eventId));
    }, [committees, events]);

    const canCreateAnyTask =
        isSuperAdmin ||
        (Boolean(activeTerm) && (isExecutive || hasCreatableHeadCommittee));

    const [scope, setScope] = useState<"mine" | "all">(defaultScope);
    const [viewMode, setViewMode] = useState<"list" | "board">("list");
    const [items, setItems] = useState<TaskDto[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);

    // Filter state
    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
    const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
    const [eventFilter, setEventFilter] = useState("");
    const [committeeFilter, setCommitteeFilter] = useState("");
    const [assigneeFilter, setAssigneeFilter] = useState("");
    const [termFilter, setTermFilter] = useState("");
    const [dueFrom, setDueFrom] = useState("");
    const [dueTo, setDueTo] = useState("");
    const [overdueOnly, setOverdueOnly] = useState(false);

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

    const [pendingBg, setPendingBg] = useState<{
        actionLabel: string;
        targetLabel: string;
        run: (reason: string) => Promise<void>;
    } | null>(null);

    const visibleCommitteeOptions = useMemo(() => {
        if (!eventFilter || eventFilter === "__general__") return committees;
        return committees.filter((c) => c.eventId === eventFilter);
    }, [committees, eventFilter]);

    const fetchTasks = useCallback(
        async (overrides?: {
            targetPage?: number;
            nextScope?: "mine" | "all";
            nextStatus?: TaskStatus | "";
            nextPriority?: TaskPriority | "";
            nextEvent?: string;
            nextCommittee?: string;
            nextAssignee?: string;
            nextTerm?: string;
            nextDueFrom?: string;
            nextDueTo?: string;
            nextOverdueOnly?: boolean;
            nextQ?: string;
        }) => {
            const effPage = overrides?.targetPage ?? 1;
            const effScope = overrides?.nextScope ?? scope;
            const effStatus = overrides?.nextStatus ?? statusFilter;
            const effPriority = overrides?.nextPriority ?? priorityFilter;
            const effEvent = overrides?.nextEvent ?? eventFilter;
            const effCommittee = overrides?.nextCommittee ?? committeeFilter;
            const effAssignee = overrides?.nextAssignee ?? assigneeFilter;
            const effTerm = overrides?.nextTerm ?? termFilter;
            const effDueFrom = overrides?.nextDueFrom ?? dueFrom;
            const effDueTo = overrides?.nextDueTo ?? dueTo;
            const effOverdue = overrides?.nextOverdueOnly ?? overdueOnly;
            const effQ = overrides?.nextQ ?? q;

            if (effDueFrom && effDueTo && effDueTo < effDueFrom) {
                setErrorMsg("'Due To' date must be on or after 'Due From' date.");
                return;
            }

            setLoading(true);
            setErrorMsg(null);
            try {
                const params = new URLSearchParams({
                    scope: effScope,
                    page: String(effPage),
                    limit: String(TASKS_DEFAULT_LIMIT),
                });
                if (effStatus) params.set("status", effStatus);
                if (effPriority) params.set("priority", effPriority);
                if (effEvent === "__general__") {
                    params.set("generalOnly", "true");
                } else if (effEvent) {
                    params.set("eventId", effEvent);
                }
                if (effCommittee) params.set("committeeId", effCommittee);
                if (effScope === "all" && effAssignee) params.set("assigneeId", effAssignee);
                if (effTerm) params.set("termId", effTerm);
                if (effDueFrom) params.set("dueFrom", effDueFrom);
                if (effDueTo) params.set("dueTo", effDueTo);
                if (effOverdue) params.set("overdueOnly", "true");
                if (effQ.trim()) params.set("q", effQ.trim());

                const res = await fetch(`${ROUTES.api.tasks}?${params.toString()}`);
                const payload = (await res.json()) as {
                    data?: {
                        items: TaskDto[];
                        pagination: { page: number; total: number };
                    };
                    error?: { message?: string };
                };
                if (!res.ok || !payload.data) {
                    setErrorMsg(payload.error?.message ?? "Failed to load tasks.");
                    return;
                }
                setItems(payload.data.items);
                setTotal(payload.data.pagination.total);
                setPage(payload.data.pagination.page);
            } catch {
                setErrorMsg("Network error while loading tasks.");
            } finally {
                setLoading(false);
            }
        },
        [
            assigneeFilter,
            committeeFilter,
            dueFrom,
            dueTo,
            eventFilter,
            overdueOnly,
            priorityFilter,
            q,
            scope,
            statusFilter,
            termFilter,
        ],
    );

    function handleFilterSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        void fetchTasks({ targetPage: 1 });
    }

    function getTaskPermissions(task: TaskDto) {
        const isLocked =
            task.academicTerm.status === "CLOSED" ||
            task.event?.status === "COMPLETED" ||
            task.event?.status === "REJECTED";
        const isOwnCommitteeHead = Boolean(
            task.committee && headedCommitteeIds.has(task.committee.id),
        );
        const canManage = isSuperAdmin || (!isLocked && (isExecutive || isOwnCommitteeHead));
        const isAssigned = task.assignees.some((a) => a.userId === actorId);
        const canProgress = canManage || (!isLocked && isAssigned);
        return { canManage, canProgress, isLocked };
    }

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
                data?: { task: TaskDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.task) {
                setErrorMsg(payload.error?.message ?? "Failed to update task status.");
                return;
            }
            setItems((prev) => prev.map((t) => (t.id === task.id ? payload.data!.task : t)));
            setPendingBg(null);
            toast.success(`Task moved to ${STATUS_LABELS[nextStatus]}.`);
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
            const payload = (await res.json()) as { error?: { message?: string } };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to delete task.");
                return;
            }
            setItems((prev) => prev.filter((t) => t.id !== task.id));
            setTotal((prev) => Math.max(0, prev - 1));
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
                targetLabel: `${task.title} -> ${STATUS_LABELS[nextStatus]}`,
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

    function renderActions(task: TaskDto) {
        const { canManage, canProgress } = getTaskPermissions(task);
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

    const kpiOpen = items.filter((t) => t.status !== "DONE").length;
    const kpiOverdue = items.filter((t) => t.isOverdue).length;
    const kpiReview = items.filter((t) => t.status === "FOR_REVIEW").length;
    const kpiDone = items.filter((t) => t.status === "DONE").length;
    const totalPages = Math.max(1, Math.ceil(total / TASKS_DEFAULT_LIMIT));

    return (
        <div className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Open Tasks</p>
                        <p className="mt-0.5 font-mono text-xl font-semibold">{kpiOpen}</p>
                    </div>
                    <CheckSquare className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Overdue</p>
                        <p className="mt-0.5 font-mono text-xl font-semibold text-destructive">
                            {kpiOverdue}
                        </p>
                    </div>
                    <ClockAlert className="size-5 text-destructive" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">For Review</p>
                        <p className="mt-0.5 font-mono text-xl font-semibold text-warning">
                            {kpiReview}
                        </p>
                    </div>
                    <Eye className="size-5 text-warning" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Completed</p>
                        <p className="mt-0.5 font-mono text-xl font-semibold text-success">
                            {kpiDone}
                        </p>
                    </div>
                    <CheckCircle2 className="size-5 text-success" strokeWidth={1.75} aria-hidden="true" />
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                    {(
                        [
                            { id: "mine", label: "My Assigned Tasks" },
                            { id: "all", label: "All Operational Tasks" },
                        ] as const
                    ).map((seg) => (
                        <button
                            key={seg.id}
                            type="button"
                            onClick={() => {
                                setScope(seg.id);
                                void fetchTasks({ targetPage: 1, nextScope: seg.id });
                            }}
                            className={`min-h-11 rounded-full border px-3.5 text-xs font-medium transition-colors sm:min-h-9 ${
                                scope === seg.id
                                    ? "border-primary bg-brand-soft text-primary dark:text-brand-accent"
                                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {seg.label}
                        </button>
                    ))}
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

                    {canCreateAnyTask ? (
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
                            <span>{isSuperAdmin ? "New Task (Break-Glass)" : "New Task"}</span>
                        </Button>
                    ) : null}
                </div>
            </div>

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

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <form
                    onSubmit={handleFilterSubmit}
                    className="flex flex-col gap-3 border-b border-border bg-muted/40 p-4"
                >
                    <div className="grid gap-3 md:grid-cols-5">
                        <div className="relative md:col-span-2">
                            <Search
                                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                            <Input
                                aria-label="Search tasks by title or description"
                                placeholder="Search title or description..."
                                className="pl-9"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                            />
                        </div>
                        <select
                            aria-label="Filter by status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}
                            className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                        >
                            <option value="">All Statuses</option>
                            {TASK_STATUSES.map((st) => (
                                <option key={st} value={st}>
                                    {STATUS_LABELS[st]}
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
                            aria-label="Filter by event"
                            value={eventFilter}
                            onChange={(e) => {
                                setEventFilter(e.target.value);
                                setCommitteeFilter("");
                            }}
                            className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                        >
                            <option value="">All Events &amp; General</option>
                            <option value="__general__">General / Event-Wide Only</option>
                            {events.map((ev) => (
                                <option key={ev.id} value={ev.id}>
                                    {ev.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid gap-3 md:grid-cols-6">
                        <select
                            aria-label="Filter by committee"
                            value={committeeFilter}
                            onChange={(e) => setCommitteeFilter(e.target.value)}
                            className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                        >
                            <option value="">All Committees</option>
                            {visibleCommitteeOptions.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>

                        {scope === "all" ? (
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
                        ) : (
                            <select
                                aria-label="Filter by academic term"
                                value={termFilter}
                                onChange={(e) => setTermFilter(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                            >
                                <option value="">All Terms</option>
                                {terms.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.code}
                                    </option>
                                ))}
                            </select>
                        )}

                        <Input
                            aria-label="Due from date (PHT)"
                            type="date"
                            className="font-mono text-xs"
                            value={dueFrom}
                            onChange={(e) => setDueFrom(e.target.value)}
                        />
                        <Input
                            aria-label="Due to date (PHT)"
                            type="date"
                            className="font-mono text-xs"
                            value={dueTo}
                            onChange={(e) => setDueTo(e.target.value)}
                        />

                        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium sm:min-h-10">
                            <input
                                type="checkbox"
                                checked={overdueOnly}
                                onChange={(e) => setOverdueOnly(e.target.checked)}
                                className="size-4 accent-primary"
                            />
                            <span>Overdue only</span>
                        </label>

                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <Loader2
                                    className="size-4 animate-spin"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                            ) : (
                                "Apply Filters"
                            )}
                        </Button>
                    </div>
                </form>

                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                        <CheckSquare
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            {scope === "mine"
                                ? "No tasks are currently assigned to you under these filters."
                                : "No operational tasks match the selected filters."}
                        </p>
                    </div>
                ) : viewMode === "list" ? (
                    <ul className="divide-y divide-border">
                        {items.map((task) => (
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
                                        <Badge variant="neutral" className="font-mono">
                                            {task.academicTerm.code}
                                        </Badge>
                                    </div>
                                    {task.description ? (
                                        <p className="mt-1.5 max-w-3xl text-xs text-muted-foreground">
                                            {task.description}
                                        </p>
                                    ) : null}
                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                        {task.event ? (
                                            <Link
                                                href={`${ROUTES.workspace.eventDetail(task.event.slug)}?tab=tasks`}
                                                className="font-medium text-primary hover:underline dark:text-brand-accent"
                                            >
                                                {task.event.title}
                                                {task.committee ? ` / ${task.committee.name}` : " / Event-Wide"}
                                            </Link>
                                        ) : (
                                            <span className="font-medium text-foreground">
                                                General Organizational Task
                                            </span>
                                        )}
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
                                <div className="shrink-0">{renderActions(task)}</div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Card className="rounded-none border-0">
                        <CardContent className="p-4">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {TASK_STATUSES.map((colStatus) => {
                                    const colItems = items.filter((t) => t.status === colStatus);
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
                                                                <TaskPriorityBadge
                                                                    priority={task.priority}
                                                                />
                                                                {task.isOverdue ? (
                                                                    <TaskOverdueBadge />
                                                                ) : null}
                                                            </div>
                                                            <p className="text-sm font-medium text-foreground">
                                                                {task.title}
                                                            </p>
                                                            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                                                {task.event ? (
                                                                    <Link
                                                                        href={`${ROUTES.workspace.eventDetail(task.event.slug)}?tab=tasks`}
                                                                        className="truncate font-medium text-primary hover:underline dark:text-brand-accent"
                                                                    >
                                                                        {task.event.title}
                                                                        {task.committee
                                                                            ? ` · ${task.committee.name}`
                                                                            : ""}
                                                                    </Link>
                                                                ) : (
                                                                    <span>General Org</span>
                                                                )}
                                                                {task.dueAt ? (
                                                                    <span className="font-mono">
                                                                        {formatManilaTimestamp(
                                                                            task.dueAt,
                                                                        )}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <div className="border-t border-border pt-2">
                                                                {renderActions(task)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {total > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
                        <span className="font-mono text-muted-foreground">
                            Showing {items.length} of {total} &bull; Page {page} of {totalPages}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={page <= 1 || loading}
                                onClick={() => void fetchTasks({ targetPage: page - 1 })}
                            >
                                <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Previous</span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={page >= totalPages || loading}
                                onClick={() => void fetchTasks({ targetPage: page + 1 })}
                            >
                                <span>Next</span>
                                <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <TaskFormModal
                open={formOpen}
                userRole={userRole}
                initialTask={editingTask}
                events={events}
                committees={committees}
                eligibleOfficers={eligibleOfficers}
                documents={documents}
                onClose={() => {
                    setFormOpen(false);
                    setEditingTask(null);
                }}
                onSaved={() => {
                    setFormOpen(false);
                    setEditingTask(null);
                    void fetchTasks({ targetPage: 1 });
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
