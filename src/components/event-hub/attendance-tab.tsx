"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
    AlertCircle,
    CalendarClock,
    Check,
    ChevronLeft,
    ChevronRight,
    ClockAlert,
    Download,
    FileCheck,
    Loader2,
    Lock,
    Pencil,
    Plus,
    QrCode,
    Radio,
    Search,
    ShieldAlert,
    UserPlus,
    X,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    ATTENDANCE_DEFAULT_LIMIT,
    ATTENDANCE_STATUSES,
    CHECKPOINT_AUDIENCE_SCOPES,
    type AttendanceRecordDto,
    type AttendanceStatus,
    type CheckpointAudienceScope,
    type CheckpointDto,
} from "@/lib/attendance/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export interface EventAttendanceTabProps {
    eventId: string;
    eventStatus: string;
    userRole: SystemRole;
}

function CheckpointBadge({ status }: { status: CheckpointDto["status"] }) {
    if (status === "OPEN") {
        return (
            <Badge variant="success">
                <Radio className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                OPEN
            </Badge>
        );
    }
    if (status === "CLOSED") {
        return (
            <Badge variant="neutral">
                <Lock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                CLOSED
            </Badge>
        );
    }
    return (
        <Badge variant="neutral">
            <CalendarClock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            SCHEDULED
        </Badge>
    );
}

function AttendanceBadge({ status }: { status: AttendanceStatus }) {
    if (status === "PRESENT") {
        return (
            <Badge variant="success">
                <Check className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                PRESENT
            </Badge>
        );
    }
    if (status === "LATE") {
        return (
            <Badge variant="warning">
                <ClockAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                LATE
            </Badge>
        );
    }
    if (status === "EXCUSED") {
        return (
            <Badge variant="info">
                <FileCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                EXCUSED
            </Badge>
        );
    }
    return (
        <Badge variant="destructive">
            <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            ABSENT
        </Badge>
    );
}

export function EventAttendanceTab({
    eventId,
    eventStatus,
    userRole,
}: EventAttendanceTabProps) {
    const canManage = userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN";
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isEventLocked = eventStatus === "COMPLETED" || eventStatus === "REJECTED";
    const isPreApproval =
        eventStatus === "DRAFT" ||
        eventStatus === "PENDING_REVIEW" ||
        eventStatus === "NEEDS_REVISION";
    const canMutate = canManage && (!isEventLocked || isSuperAdmin);
    const canCreateCheckpoint = canMutate && !isPreApproval;
    const canOpenCheckpoint =
        eventStatus === "PUBLISHED" || (eventStatus === "COMPLETED" && isSuperAdmin);

    const [loading, setLoading] = useState(true);
    const [checkpoints, setCheckpoints] = useState<CheckpointDto[]>([]);
    const [records, setRecords] = useState<AttendanceRecordDto[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Filter state
    const [q, setQ] = useState("");
    const [checkpointFilter, setCheckpointFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [filtering, setFiltering] = useState(false);

    // Add checkpoint state
    const [showAddCp, setShowAddCp] = useState(false);
    const [cpLabel, setCpLabel] = useState("");
    const [cpScope, setCpScope] = useState<CheckpointAudienceScope>("ALL");
    const [cpSort, setCpSort] = useState("1");
    const [cpBgReason, setCpBgReason] = useState("");
    const [savingCp, setSavingCp] = useState(false);
    const [togglingCpId, setTogglingCpId] = useState<string | null>(null);

    // Manual add / override state
    const [overrideMode, setOverrideMode] = useState<"create" | "edit" | null>(null);
    const [overrideRecord, setOverrideRecord] = useState<AttendanceRecordDto | null>(null);
    const [overrideCheckpointId, setOverrideCheckpointId] = useState("");
    const [overrideStudentId, setOverrideStudentId] = useState("");
    const [overrideStatus, setOverrideStatus] = useState<AttendanceStatus>("PRESENT");
    const [overrideReason, setOverrideReason] = useState("");
    const [savingOverride, setSavingOverride] = useState(false);

    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const buildRecordParams = useCallback(
        (targetPage?: number) => {
            const params = new URLSearchParams({ eventId });
            if (q.trim()) params.set("q", q.trim());
            if (checkpointFilter) params.set("checkpointId", checkpointFilter);
            if (statusFilter) params.set("status", statusFilter);
            if (fromDate) params.set("from", fromDate);
            if (toDate) params.set("to", toDate);
            if (targetPage !== undefined) {
                params.set("page", String(targetPage));
                params.set("limit", String(ATTENDANCE_DEFAULT_LIMIT));
            }
            return params;
        },
        [checkpointFilter, eventId, fromDate, q, statusFilter, toDate],
    );

    const loadTabData = useCallback(
        async (targetPage = 1) => {
            try {
                const [cpRes, recRes] = await Promise.all([
                    fetch(
                        `${ROUTES.api.attendance.checkpoints}?eventId=${encodeURIComponent(eventId)}`,
                    ),
                    fetch(
                        `${ROUTES.api.attendance.records}?${buildRecordParams(targetPage).toString()}`,
                    ),
                ]);

                const errors: string[] = [];
                if (cpRes.ok) {
                    const cpPayload = (await cpRes.json()) as {
                        data?: { checkpoints: CheckpointDto[] };
                    };
                    if (cpPayload.data) {
                        const nextCps = cpPayload.data.checkpoints;
                        setCheckpoints(nextCps);
                        setOverrideCheckpointId((prev) => prev || nextCps[0]?.id || "");
                    }
                } else {
                    const cpErr = (await cpRes.json().catch(() => null)) as {
                        error?: { message?: string };
                    } | null;
                    errors.push(cpErr?.error?.message ?? "Failed to load checkpoints.");
                }

                if (recRes.ok) {
                    const recPayload = (await recRes.json()) as {
                        data?: {
                            items: AttendanceRecordDto[];
                            pagination: { page: number; total: number };
                        };
                    };
                    if (recPayload.data) {
                        setRecords(recPayload.data.items);
                        setTotal(recPayload.data.pagination.total);
                        setPage(recPayload.data.pagination.page);
                    }
                } else {
                    const recErr = (await recRes.json().catch(() => null)) as {
                        error?: { message?: string };
                    } | null;
                    errors.push(recErr?.error?.message ?? "Failed to load attendance records.");
                }

                if (errors.length > 0) {
                    setErrorMsg(errors.join(" "));
                }
            } catch {
                setErrorMsg("Network error while loading attendance data.");
            } finally {
                setLoading(false);
            }
        },
        [buildRecordParams, eventId],
    );

    useEffect(() => {
        let cancelled = false;
        async function loadInitial() {
            try {
                const [cpRes, recRes] = await Promise.all([
                    fetch(
                        `${ROUTES.api.attendance.checkpoints}?eventId=${encodeURIComponent(eventId)}`,
                    ),
                    fetch(
                        `${ROUTES.api.attendance.records}?${new URLSearchParams({
                            eventId,
                            page: "1",
                            limit: String(ATTENDANCE_DEFAULT_LIMIT),
                        }).toString()}`,
                    ),
                ]);
                if (cancelled) return;

                const errors: string[] = [];
                if (cpRes.ok) {
                    const cpPayload = (await cpRes.json()) as {
                        data?: { checkpoints: CheckpointDto[] };
                    };
                    if (!cancelled && cpPayload.data) {
                        const nextCps = cpPayload.data.checkpoints;
                        setCheckpoints(nextCps);
                        setOverrideCheckpointId((prev) => prev || nextCps[0]?.id || "");
                    }
                } else {
                    const cpErr = (await cpRes.json().catch(() => null)) as {
                        error?: { message?: string };
                    } | null;
                    errors.push(cpErr?.error?.message ?? "Failed to load checkpoints.");
                }

                if (recRes.ok) {
                    const recPayload = (await recRes.json()) as {
                        data?: {
                            items: AttendanceRecordDto[];
                            pagination: { page: number; total: number };
                        };
                    };
                    if (!cancelled && recPayload.data) {
                        setRecords(recPayload.data.items);
                        setTotal(recPayload.data.pagination.total);
                        setPage(recPayload.data.pagination.page);
                    }
                } else {
                    const recErr = (await recRes.json().catch(() => null)) as {
                        error?: { message?: string };
                    } | null;
                    errors.push(recErr?.error?.message ?? "Failed to load attendance records.");
                }

                if (!cancelled && errors.length > 0) {
                    setErrorMsg(errors.join(" "));
                }
            } catch {
                if (!cancelled) {
                    setErrorMsg("Network error while loading attendance data.");
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

    async function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (fromDate && toDate && toDate < fromDate) {
            setErrorMsg("'To' date must be on or after 'From' date.");
            return;
        }
        setErrorMsg(null);
        setFiltering(true);
        try {
            await loadTabData(1);
        } finally {
            setFiltering(false);
        }
    }

    async function handleCreateCheckpoint(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);
        setSavingCp(true);
        try {
            const res = await fetch(ROUTES.api.attendance.checkpoints, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eventId,
                    label: cpLabel,
                    audienceScope: cpScope,
                    sortOrder: Number(cpSort) || 1,
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: cpBgReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as { error?: { message?: string } };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to create checkpoint.");
                return;
            }
            toast.success(`Checkpoint "${cpLabel.trim()}" created.`);
            setCpLabel("");
            setShowAddCp(false);
            await loadTabData(1);
        } catch {
            setErrorMsg("Network error while creating checkpoint. Please try again.");
        } finally {
            setSavingCp(false);
        }
    }

    async function handleToggleCheckpointStatus(
        cp: CheckpointDto,
        nextStatus: "OPEN" | "CLOSED",
    ) {
        if (isSuperAdmin && cpBgReason.trim().length < 10) {
            setErrorMsg(
                "Super Admin break-glass changes require a reason of at least 10 characters.",
            );
            return;
        }
        setErrorMsg(null);
        setTogglingCpId(cp.id);
        try {
            const res = await fetch(`${ROUTES.api.attendance.checkpoints}/${cp.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: cpBgReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as { error?: { message?: string } };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to update checkpoint.");
                return;
            }
            toast.success(`Checkpoint "${cp.label}" is now ${nextStatus}.`);
            await loadTabData(page);
        } catch {
            setErrorMsg("Network error while updating checkpoint. Please try again.");
        } finally {
            setTogglingCpId(null);
        }
    }

    async function handleOverrideSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!overrideMode) return;
        setErrorMsg(null);
        setSavingOverride(true);
        try {
            const isEdit = overrideMode === "edit" && overrideRecord;
            const res = await fetch(ROUTES.api.attendance.override, {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    isEdit
                        ? {
                              recordId: overrideRecord.id,
                              status: overrideStatus,
                              editReason: overrideReason,
                              ...(isSuperAdmin ? { breakGlass: true } : {}),
                          }
                        : {
                              checkpointId: overrideCheckpointId,
                              studentIdNumber: overrideStudentId,
                              status: overrideStatus,
                              editReason: overrideReason,
                              ...(isSuperAdmin ? { breakGlass: true } : {}),
                          },
                ),
            });
            const payload = (await res.json()) as { error?: { message?: string } };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to save attendance override.");
                return;
            }
            toast.success(isEdit ? "Attendance record updated." : "Manual attendance logged.");
            setOverrideMode(null);
            setOverrideRecord(null);
            setOverrideStudentId("");
            setOverrideReason("");
            await loadTabData(page);
        } catch {
            setErrorMsg("Network error while saving attendance override. Please try again.");
        } finally {
            setSavingOverride(false);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil(total / ATTENDANCE_DEFAULT_LIMIT));
    const exportHref = `${ROUTES.api.attendance.export}?${buildRecordParams().toString()}`;
    const minOverrideReason = isSuperAdmin ? 10 : 5;

    return (
        <div className="flex flex-col gap-6">
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

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <div>
                        <CardTitle>Dynamic Checkpoints</CardTitle>
                        <CardDescription>
                            Event status:{" "}
                            <span className="font-mono text-xs text-foreground">{eventStatus}</span>
                        </CardDescription>
                    </div>
                    {canMutate ? (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={!canCreateCheckpoint}
                                title={
                                    isPreApproval
                                        ? "Checkpoints require an APPROVED or PUBLISHED event."
                                        : undefined
                                }
                                onClick={() => setShowAddCp((v) => !v)}
                            >
                                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Add Checkpoint</span>
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={checkpoints.length === 0}
                                onClick={() => {
                                    setOverrideMode("create");
                                    setOverrideRecord(null);
                                    setOverrideCheckpointId(checkpoints[0]?.id ?? "");
                                    setOverrideStatus("PRESENT");
                                    setOverrideReason("");
                                }}
                            >
                                <UserPlus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Manual Entry</span>
                            </Button>
                        </div>
                    ) : null}
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                    {isEventLocked && !isSuperAdmin ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                            <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                            <span>
                                Attendance is read-only for {eventStatus.toLowerCase()} events.
                                Only Super Admin break-glass overrides can modify locked records.
                            </span>
                        </div>
                    ) : canManage && isPreApproval ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                            <CalendarClock
                                className="size-3.5 shrink-0"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                            <span>
                                Dynamic checkpoints can be added once this event proposal is
                                APPROVED, and opened for scanning once PUBLISHED.
                            </span>
                        </div>
                    ) : null}

                    {canMutate && isSuperAdmin ? (
                        <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                            <label
                                htmlFor="hub-cp-bg-reason"
                                className="flex items-center gap-1.5 text-xs font-medium text-warning"
                            >
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Super Admin Break-Glass Reason (required min 10 chars for
                                checkpoint mutations)
                            </label>
                            <Input
                                id="hub-cp-bg-reason"
                                placeholder="Explain why Super Admin is configuring or toggling this checkpoint..."
                                value={cpBgReason}
                                onChange={(e) => setCpBgReason(e.target.value)}
                            />
                        </div>
                    ) : null}

                    {canCreateCheckpoint && showAddCp ? (
                        <form
                            onSubmit={handleCreateCheckpoint}
                            className="grid gap-3 rounded-md border border-border bg-muted/50 p-3.5 sm:grid-cols-4"
                        >
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                                <label htmlFor="hub-cp-label" className="text-xs font-medium">
                                    Checkpoint Label
                                </label>
                                <Input
                                    id="hub-cp-label"
                                    placeholder="AM In"
                                    value={cpLabel}
                                    onChange={(e) => setCpLabel(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="hub-cp-scope" className="text-xs font-medium">
                                    Audience Scope
                                </label>
                                <select
                                    id="hub-cp-scope"
                                    value={cpScope}
                                    onChange={(e) =>
                                        setCpScope(e.target.value as CheckpointAudienceScope)
                                    }
                                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                                >
                                    {CHECKPOINT_AUDIENCE_SCOPES.map((scope) => (
                                        <option key={scope} value={scope}>
                                            {scope}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="hub-cp-sort" className="text-xs font-medium">
                                    Sort Order
                                </label>
                                <Input
                                    id="hub-cp-sort"
                                    type="number"
                                    min={1}
                                    max={100}
                                    className="font-mono"
                                    value={cpSort}
                                    onChange={(e) => setCpSort(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-2 sm:col-span-4">
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={
                                        savingCp ||
                                        (isSuperAdmin && cpBgReason.trim().length < 10)
                                    }
                                >
                                    {savingCp ? "Creating..." : "Create Checkpoint"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAddCp(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    ) : null}

                    {checkpoints.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            No checkpoints configured for this event yet.
                        </p>
                    ) : (
                        <div className="divide-y divide-border rounded-lg border border-border">
                            {checkpoints.map((cp) => {
                                const busy = togglingCpId === cp.id;
                                return (
                                    <div
                                        key={cp.id}
                                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                                    >
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="font-medium">{cp.label}</span>
                                            <CheckpointBadge status={cp.status} />
                                            <Badge variant="neutral">{cp.audienceScope}</Badge>
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {cp.recordCount} logs
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            {cp.status === "OPEN" ? (
                                                <Link
                                                    href={`${ROUTES.workspace.scanner}?checkpointId=${cp.id}`}
                                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-9"
                                                >
                                                    <QrCode
                                                        className="size-3.5"
                                                        strokeWidth={1.75}
                                                        aria-hidden="true"
                                                    />
                                                    <span>Scan Checkpoint</span>
                                                </Link>
                                            ) : null}
                                            {canMutate && cp.status !== "OPEN" ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={busy || !canOpenCheckpoint}
                                                    title={
                                                        !canOpenCheckpoint
                                                            ? "Event must be PUBLISHED before opening checkpoints."
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        void handleToggleCheckpointStatus(
                                                            cp,
                                                            "OPEN",
                                                        )
                                                    }
                                                >
                                                    Open
                                                </Button>
                                            ) : null}
                                            {canMutate && cp.status === "OPEN" ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void handleToggleCheckpointStatus(
                                                            cp,
                                                            "CLOSED",
                                                        )
                                                    }
                                                >
                                                    Close
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {canMutate && overrideMode ? (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {overrideMode === "edit" && overrideRecord
                                ? `Override Attendance — ${overrideRecord.studentIdNumber} (${overrideRecord.fullName})`
                                : "Manual Executive Attendance Entry"}
                        </CardTitle>
                        <CardDescription>
                            All manual entries and overrides require an explanation and write an
                            immutable audit entry.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleOverrideSubmit} className="grid gap-3 md:grid-cols-4">
                            {overrideMode === "create" ? (
                                <>
                                    <div className="flex flex-col gap-1.5">
                                        <label
                                            htmlFor="override-cp"
                                            className="text-xs font-medium"
                                        >
                                            Checkpoint
                                        </label>
                                        <select
                                            id="override-cp"
                                            value={overrideCheckpointId}
                                            onChange={(e) =>
                                                setOverrideCheckpointId(e.target.value)
                                            }
                                            className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                                        >
                                            {checkpoints.map((cp) => (
                                                <option key={cp.id} value={cp.id}>
                                                    {cp.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label
                                            htmlFor="override-student"
                                            className="text-xs font-medium"
                                        >
                                            Student ID
                                        </label>
                                        <Input
                                            id="override-student"
                                            placeholder="2024-01234"
                                            className="font-mono"
                                            value={overrideStudentId}
                                            onChange={(e) => setOverrideStudentId(e.target.value)}
                                            required
                                        />
                                    </div>
                                </>
                            ) : null}

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="override-status" className="text-xs font-medium">
                                    Attendance Status
                                </label>
                                <select
                                    id="override-status"
                                    value={overrideStatus}
                                    onChange={(e) =>
                                        setOverrideStatus(e.target.value as AttendanceStatus)
                                    }
                                    className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                                >
                                    {ATTENDANCE_STATUSES.map((st) => (
                                        <option key={st} value={st}>
                                            {st}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div
                                className={
                                    overrideMode === "edit"
                                        ? "flex flex-col gap-1.5 md:col-span-3"
                                        : "flex flex-col gap-1.5"
                                }
                            >
                                <label htmlFor="override-reason" className="text-xs font-medium">
                                    {isSuperAdmin ? (
                                        <span className="inline-flex items-center gap-1 text-warning">
                                            <ShieldAlert
                                                className="size-3.5"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            Break-Glass Edit Reason (min 10 chars)
                                        </span>
                                    ) : (
                                        "Audit Reason (min 5 chars)"
                                    )}
                                </label>
                                <Input
                                    id="override-reason"
                                    placeholder="Verified in person with ID / excused letter..."
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
                                <Button
                                    type="submit"
                                    disabled={
                                        savingOverride ||
                                        overrideReason.trim().length < minOverrideReason
                                    }
                                >
                                    {savingOverride ? "Saving..." : "Save Attendance"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setOverrideMode(null);
                                        setOverrideRecord(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <form
                    onSubmit={handleFilterSubmit}
                    className="grid gap-3 border-b border-border bg-muted/40 p-4 md:grid-cols-6"
                >
                    <div className="relative md:col-span-2">
                        <Search
                            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        <Input
                            aria-label="Search Student ID or name"
                            placeholder="Search Student ID or name..."
                            className="pl-9"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <select
                        aria-label="Filter by checkpoint"
                        value={checkpointFilter}
                        onChange={(e) => setCheckpointFilter(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Checkpoints</option>
                        {checkpoints.map((cp) => (
                            <option key={cp.id} value={cp.id}>
                                {cp.label}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by attendance status"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Statuses</option>
                        {ATTENDANCE_STATUSES.map((st) => (
                            <option key={st} value={st}>
                                {st}
                            </option>
                        ))}
                    </select>
                    <Input
                        aria-label="From date (PHT)"
                        type="date"
                        className="font-mono text-xs"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <Input
                            aria-label="To date (PHT)"
                            type="date"
                            className="min-w-0 flex-1 font-mono text-xs"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                        />
                        <Button type="submit" disabled={filtering}>
                            {filtering ? (
                                <Loader2
                                    className="size-4 animate-spin"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                            ) : (
                                "Filter"
                            )}
                        </Button>
                    </div>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
                    <span>
                        Showing <span className="font-mono text-foreground">{records.length}</span>{" "}
                        of <span className="font-mono text-foreground">{total}</span> records
                    </span>
                    <a
                        href={exportHref}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted sm:min-h-9"
                    >
                        <Download className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Export CSV (max 2,000)</span>
                    </a>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3">Student ID</th>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Checkpoint</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Recorded (PHT)</th>
                                {canMutate ? <th className="px-4 py-3 text-right">Action</th> : null}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {records.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={canMutate ? 6 : 5}
                                        className="px-4 py-10 text-center text-muted-foreground"
                                    >
                                        No attendance records found.
                                    </td>
                                </tr>
                            ) : (
                                records.map((rec) => (
                                    <tr key={rec.id}>
                                        <td className="px-4 py-3 font-mono text-xs font-medium">
                                            {rec.studentIdNumber}
                                        </td>
                                        <td className="px-4 py-3 font-medium">{rec.fullName}</td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">
                                            {rec.checkpointLabel}
                                        </td>
                                        <td className="px-4 py-3">
                                            <AttendanceBadge status={rec.status} />
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                            {formatManilaTimestamp(rec.recordedAt)}
                                        </td>
                                        {canMutate ? (
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => {
                                                        setOverrideMode("edit");
                                                        setOverrideRecord(rec);
                                                        setOverrideStatus(rec.status);
                                                        setOverrideReason("");
                                                    }}
                                                >
                                                    <Pencil
                                                        className="size-3.5"
                                                        strokeWidth={1.75}
                                                        aria-hidden="true"
                                                    />
                                                    <span>Override</span>
                                                </Button>
                                            </td>
                                        ) : null}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {total > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
                        <span className="font-mono text-muted-foreground">
                            Page {page} of {totalPages}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => void loadTabData(page - 1)}
                            >
                                <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Previous</span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={page >= totalPages}
                                onClick={() => void loadTabData(page + 1)}
                            >
                                <span>Next</span>
                                <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
