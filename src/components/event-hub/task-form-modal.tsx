"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import type { EligibleOfficerOption } from "@/app/api/events/_lib/validation";
import {
    TASK_PRIORITIES,
    type EventTaskProgressSummary,
    type TaskDocumentOption,
    type TaskDto,
    type TaskPriority,
    type TaskWorkspaceCommitteeOption,
    type TaskWorkspaceEventOption,
} from "@/app/api/tasks/_lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function toManilaDateTimeLocal(iso: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const hour = map.hour === "24" ? "00" : map.hour;
    return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

export interface TaskFormModalProps {
    open: boolean;
    userRole: SystemRole;
    initialTask?: TaskDto | null;
    lockedEventId?: string | null;
    events?: TaskWorkspaceEventOption[];
    committees: TaskWorkspaceCommitteeOption[];
    eligibleOfficers: EligibleOfficerOption[];
    documents?: TaskDocumentOption[];
    onClose: () => void;
    onSaved: (task: TaskDto, eventSummary?: EventTaskProgressSummary) => void;
}

export function TaskFormModal(props: TaskFormModalProps) {
    if (!props.open) return null;
    return (
        <TaskFormModalBody
            key={`${props.initialTask?.id ?? "new"}-${props.lockedEventId ?? "global"}`}
            {...props}
        />
    );
}

function TaskFormModalBody({
    userRole,
    initialTask = null,
    lockedEventId = null,
    events = [],
    committees,
    eligibleOfficers,
    documents = [],
    onClose,
    onSaved,
}: TaskFormModalProps) {
    const isEdit = Boolean(initialTask);
    const isExecutiveOrAdmin = userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN";
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    const eligibleEvents = useMemo(
        () =>
            events.filter(
                (ev) =>
                    isSuperAdmin ||
                    ((ev.status === "APPROVED" || ev.status === "PUBLISHED") &&
                        ev.academicTermStatus !== "CLOSED"),
            ),
        [events, isSuperAdmin],
    );

    const officerHeadCommittees = useMemo(
        () => committees.filter((c) => c.isActorHead),
        [committees],
    );

    const defaultEventId =
        lockedEventId ??
        initialTask?.event?.id ??
        (!isExecutiveOrAdmin ? (officerHeadCommittees[0]?.eventId ?? "") : "");

    const [selectedEventId, setSelectedEventId] = useState(defaultEventId);
    const [selectedCommitteeId, setSelectedCommitteeId] = useState(() => {
        if (initialTask?.committee?.id) return initialTask.committee.id;
        if (!isExecutiveOrAdmin) {
            const match = officerHeadCommittees.find((c) => c.eventId === defaultEventId);
            return match?.id ?? officerHeadCommittees[0]?.id ?? "";
        }
        return "";
    });
    const [title, setTitle] = useState(initialTask?.title ?? "");
    const [description, setDescription] = useState(initialTask?.description ?? "");
    const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority ?? "MEDIUM");
    const [dueAt, setDueAt] = useState(toManilaDateTimeLocal(initialTask?.dueAt ?? null));
    const [linkedDocumentId, setLinkedDocumentId] = useState(
        initialTask?.linkedDocument?.id ?? "",
    );
    const [assigneeIds, setAssigneeIds] = useState<string[]>(
        initialTask?.assignees.map((a) => a.userId) ?? [],
    );
    const [breakGlassReason, setBreakGlassReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !saving) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose, saving]);

    const availableCommittees = useMemo(() => {
        const scoped = committees.filter((c) => c.eventId === selectedEventId);
        return isExecutiveOrAdmin ? scoped : scoped.filter((c) => c.isActorHead);
    }, [committees, isExecutiveOrAdmin, selectedEventId]);

    const selectableDocuments = useMemo(() => {
        if (!selectedEventId) return documents;
        return documents.filter((d) => d.eventId === selectedEventId || d.eventId === null);
    }, [documents, selectedEventId]);

    function toggleAssignee(userId: string) {
        setAssigneeIds((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
        );
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErrorMsg(null);

        if (isSuperAdmin && breakGlassReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass changes require at least 10 characters.");
            return;
        }

        const effectiveCommitteeId = selectedEventId
            ? selectedCommitteeId ||
              (!isExecutiveOrAdmin ? (availableCommittees[0]?.id ?? "") : "")
            : "";

        if (!isExecutiveOrAdmin && !effectiveCommitteeId) {
            setErrorMsg("Committee Heads can only create tasks inside their assigned committee.");
            return;
        }

        setSaving(true);
        try {
            const url = isEdit
                ? `${ROUTES.api.tasks}/${initialTask!.id}`
                : ROUTES.api.tasks;
            const method = isEdit ? "PATCH" : "POST";

            const payloadBody = isEdit
                ? {
                      title: title.trim(),
                      description: description.trim() || null,
                      priority,
                      dueAt: dueAt ? `${dueAt}:00+08:00` : null,
                      linkedDocumentId: linkedDocumentId || null,
                      assigneeIds,
                      ...(isExecutiveOrAdmin && initialTask?.event
                          ? { committeeId: effectiveCommitteeId || null }
                          : {}),
                      ...(isSuperAdmin
                          ? { breakGlass: true, reason: breakGlassReason.trim() }
                          : {}),
                  }
                : {
                      title: title.trim(),
                      description: description.trim() || null,
                      eventId: selectedEventId || null,
                      committeeId: effectiveCommitteeId || null,
                      priority,
                      dueAt: dueAt ? `${dueAt}:00+08:00` : null,
                      linkedDocumentId: linkedDocumentId || null,
                      assigneeIds,
                      ...(isSuperAdmin
                          ? { breakGlass: true, reason: breakGlassReason.trim() }
                          : {}),
                  };

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadBody),
            });
            const data = (await res.json()) as {
                data?: { task: TaskDto; eventSummary?: EventTaskProgressSummary };
                error?: { message?: string };
            };
            if (!res.ok || !data.data?.task) {
                setErrorMsg(data.error?.message ?? "Failed to save task.");
                return;
            }
            toast.success(isEdit ? "Task updated." : "Task created.");
            onSaved(data.data.task, data.data.eventSummary);
        } catch {
            setErrorMsg("Network error while saving task. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
        >
            <div
                className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                style={{ boxShadow: "var(--shadow-overlay-md)" }}
            >
                <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div>
                        <h2 id="task-modal-title" className="text-base font-semibold">
                            {isEdit ? "Edit Deliverable / Task" : "Create Deliverable / Task"}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {isExecutiveOrAdmin
                                ? "Assign active officers, priority, due date, and optional linked Drive document."
                                : "Scoped strictly to your assigned Committee Head responsibilities."}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving}
                        aria-label="Close task dialog"
                        onClick={onClose}
                    >
                        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </div>

                {errorMsg ? (
                    <div
                        role="alert"
                        aria-live="polite"
                        className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
                    >
                        <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span>{errorMsg}</span>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="task-title-input" className="text-xs font-medium">
                            Task Title
                        </label>
                        <Input
                            id="task-title-input"
                            required
                            maxLength={200}
                            disabled={saving}
                            placeholder="e.g., Finalize stage audio equipment checklist"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    {!lockedEventId && !isEdit ? (
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="task-event-select" className="text-xs font-medium">
                                Event Scope
                            </label>
                            <select
                                id="task-event-select"
                                disabled={saving}
                                value={selectedEventId}
                                onChange={(e) => {
                                    const nextEvent = e.target.value;
                                    setSelectedEventId(nextEvent);
                                    if (!isExecutiveOrAdmin) {
                                        const firstHead = committees.find(
                                            (c) => c.eventId === nextEvent && c.isActorHead,
                                        );
                                        setSelectedCommitteeId(firstHead?.id ?? "");
                                    } else {
                                        setSelectedCommitteeId("");
                                    }
                                }}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                {isExecutiveOrAdmin ? (
                                    <option value="">
                                        General Organizational Task (No Event)
                                    </option>
                                ) : null}
                                {eligibleEvents
                                    .filter(
                                        (ev) =>
                                            isExecutiveOrAdmin ||
                                            officerHeadCommittees.some((c) => c.eventId === ev.id),
                                    )
                                    .map((ev) => (
                                        <option key={ev.id} value={ev.id}>
                                            {ev.title} ({ev.academicTermCode})
                                        </option>
                                    ))}
                            </select>
                        </div>
                    ) : null}

                    {selectedEventId && (!isEdit || isExecutiveOrAdmin) ? (
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="task-committee-select" className="text-xs font-medium">
                                Committee Assignment
                            </label>
                            <select
                                id="task-committee-select"
                                disabled={saving || (!isExecutiveOrAdmin && availableCommittees.length <= 1)}
                                value={
                                    selectedCommitteeId ||
                                    (!isExecutiveOrAdmin ? (availableCommittees[0]?.id ?? "") : "")
                                }
                                onChange={(e) => setSelectedCommitteeId(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                {isExecutiveOrAdmin ? (
                                    <option value="">Event-Wide (No Specific Committee)</option>
                                ) : null}
                                {availableCommittees.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="task-priority-select" className="text-xs font-medium">
                                Priority
                            </label>
                            <select
                                id="task-priority-select"
                                disabled={saving}
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                {TASK_PRIORITIES.map((p) => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="task-due-input" className="text-xs font-medium">
                                Due Date &amp; Time (PHT, Optional)
                            </label>
                            <Input
                                id="task-due-input"
                                type="datetime-local"
                                disabled={saving}
                                className="font-mono text-xs"
                                value={dueAt}
                                onChange={(e) => setDueAt(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="task-desc-input" className="text-xs font-medium">
                            Instructions / Acceptance Notes (Optional)
                        </label>
                        <textarea
                            id="task-desc-input"
                            rows={3}
                            maxLength={4000}
                            disabled={saving}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Define deliverable expectations, handoff details, or dependencies..."
                            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                        />
                    </div>

                    {selectableDocuments.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="task-doc-select" className="text-xs font-medium">
                                Linked Google Drive Document (Optional)
                            </label>
                            <select
                                id="task-doc-select"
                                disabled={saving}
                                value={linkedDocumentId}
                                onChange={(e) => setLinkedDocumentId(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                <option value="">None</option>
                                {selectableDocuments.map((doc) => (
                                    <option key={doc.id} value={doc.id}>
                                        {doc.title}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium">
                            Assigned Officers ({assigneeIds.length} selected)
                        </span>
                        {eligibleOfficers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No active term officers available to assign.
                            </p>
                        ) : (
                            <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
                                <div className="grid gap-1 sm:grid-cols-2">
                                    {eligibleOfficers.map((officer) => {
                                        const checked = assigneeIds.includes(officer.userId);
                                        return (
                                            <label
                                                key={officer.userId}
                                                className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-card sm:min-h-9"
                                            >
                                                <input
                                                    type="checkbox"
                                                    disabled={saving}
                                                    checked={checked}
                                                    onChange={() => toggleAssignee(officer.userId)}
                                                    className="size-4 shrink-0 accent-primary"
                                                />
                                                <span className="min-w-0 truncate">
                                                    <span className="font-medium text-foreground">
                                                        {officer.fullName}
                                                    </span>{" "}
                                                    <span className="font-mono text-muted-foreground">
                                                        ({officer.studentIdNumber})
                                                    </span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {isSuperAdmin ? (
                        <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                            <label
                                htmlFor="task-modal-bg-reason"
                                className="flex items-center gap-1.5 text-xs font-medium text-warning"
                            >
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Super Admin Break-Glass Audit Reason (min 10 chars)
                            </label>
                            <Input
                                id="task-modal-bg-reason"
                                required
                                disabled={saving}
                                value={breakGlassReason}
                                onChange={(e) => setBreakGlassReason(e.target.value)}
                                placeholder="Document why Super Admin is creating or editing this task..."
                            />
                        </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                saving ||
                                title.trim().length < 3 ||
                                (isSuperAdmin && breakGlassReason.trim().length < 10)
                            }
                        >
                            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
