"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import {
    AlertCircle,
    ArrowLeft,
    Ban,
    CalendarClock,
    Check,
    CheckCheck,
    ClockAlert,
    Download,
    FileCheck,
    FileUp,
    FolderOpen,
    Link2,
    Lock,
    MapPin,
    Pencil,
    PlayCircle,
    Plus,
    QrCode,
    Radio,
    ShieldAlert,
    UserPlus,
    X,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    ATTENDANCE_STATUSES,
    type AttendanceRecordDto,
    type AttendanceStatus,
    type CheckpointDto,
} from "@/lib/attendance/validation";
import {
    formatFileSizeBytes,
    type ActiveDocumentTypeOption,
    type DocumentDto,
    type DocumentTermOption,
} from "@/lib/drive/validation";
import type { MeetingDetailDto } from "@/app/api/meetings/_lib/validation";
import { BreakGlassDialog } from "@/app/(workspace)/documents/_components/break-glass-dialog";
import { DocumentDetailDrawer } from "@/app/(workspace)/documents/_components/document-detail-drawer";
import {
    DocumentStatusBadge,
    StorageModeBadge,
} from "@/app/(workspace)/documents/_components/document-status-badge";
import { DocumentUploadDialog } from "@/app/(workspace)/documents/_components/document-upload-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MeetingFormDialog } from "./meeting-form-dialog";
import { MeetingRichTextEditor, SafeRichTextDisplay } from "./meeting-rich-text-editor";
import { MeetingStatusBadge } from "./meeting-status-badge";

interface MeetingDetailWorkspaceProps {
    userRole: SystemRole;
    hasActiveAppointment: boolean;
    initialMeeting: MeetingDetailDto;
    initialCheckpoints: CheckpointDto[];
    initialAttendance: AttendanceRecordDto[];
    initialDocuments: DocumentDto[];
    documentTypes: ActiveDocumentTypeOption[];
    activeTerm: DocumentTermOption | null;
    driveShareMode: "domain" | "unlisted";
    maxUploadSizeBytes: number;
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

export function MeetingDetailWorkspace({
    userRole,
    hasActiveAppointment,
    initialMeeting,
    initialCheckpoints,
    initialAttendance,
    initialDocuments,
    documentTypes,
    activeTerm,
    driveShareMode,
    maxUploadSizeBytes,
}: MeetingDetailWorkspaceProps) {
    const canManage = userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN";
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    const [meeting, setMeeting] = useState<MeetingDetailDto>(initialMeeting);
    const [checkpoints, setCheckpoints] = useState<CheckpointDto[]>(initialCheckpoints);
    const [attendance, setAttendance] = useState<AttendanceRecordDto[]>(initialAttendance);
    const [docs, setDocs] = useState<DocumentDto[]>(initialDocuments);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Edit details & agenda modal
    const [editOpen, setEditOpen] = useState(false);

    // Cancel modal / reason
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [savingTransition, setSavingTransition] = useState(false);

    // Super Admin break-glass dialog for one-click transitions
    const [bgTransition, setBgTransition] = useState<{
        actionLabel: string;
        status: "ONGOING" | "COMPLETED";
    } | null>(null);

    // Minutes editor
    const [editingMinutes, setEditingMinutes] = useState(false);
    const [minutesDraft, setMinutesDraft] = useState(initialMeeting.minutesHtml ?? "");
    const [minutesBgReason, setMinutesBgReason] = useState("");
    const [savingMinutes, setSavingMinutes] = useState(false);

    // Officer Attendance Checkpoints (reusing M3A /api/attendance/*)
    const [showAddCp, setShowAddCp] = useState(false);
    const [cpLabel, setCpLabel] = useState("");
    const [cpSort, setCpSort] = useState("1");
    const [cpBgReason, setCpBgReason] = useState("");
    const [savingCp, setSavingCp] = useState(false);
    const [togglingCpId, setTogglingCpId] = useState<string | null>(null);

    // Executive manual officer attendance entry / override
    const [overrideMode, setOverrideMode] = useState<"create" | "edit" | null>(null);
    const [overrideRecord, setOverrideRecord] = useState<AttendanceRecordDto | null>(null);
    const [overrideCheckpointId, setOverrideCheckpointId] = useState(
        initialCheckpoints[0]?.id ?? "",
    );
    const [overrideStudentId, setOverrideStudentId] = useState("");
    const [overrideStatus, setOverrideStatus] = useState<AttendanceStatus>("PRESENT");
    const [overrideReason, setOverrideReason] = useState("");
    const [savingOverride, setSavingOverride] = useState(false);

    // Documents (reusing M4A /api/documents/*)
    const [uploadMode, setUploadMode] = useState<"upload" | "external" | null>(null);
    const [selectedDoc, setSelectedDoc] = useState<DocumentDto | null>(null);

    const isLocked =
        meeting.academicTerm.status === "CLOSED" ||
        meeting.status === "COMPLETED" ||
        meeting.status === "CANCELLED";

    const canEditMinutes =
        userRole === "SUPER_ADMIN" ||
        (!isLocked &&
            (userRole === "EXECUTIVE" ||
                (userRole === "OFFICER" && hasActiveAppointment)));

    const refreshMeetingBundle = useCallback(async () => {
        const res = await fetch(`${ROUTES.api.meetings}/${meeting.id}`);
        const payload = (await res.json()) as {
            data?: {
                meeting: MeetingDetailDto;
                checkpoints: CheckpointDto[];
                documents: DocumentDto[];
            };
        };
        if (res.ok && payload.data) {
            setMeeting(payload.data.meeting);
            setCheckpoints(payload.data.checkpoints);
            setDocs(payload.data.documents);
            setOverrideCheckpointId((prev) => prev || payload.data!.checkpoints[0]?.id || "");
        }

        const recRes = await fetch(
            `${ROUTES.api.attendance.records}?${new URLSearchParams({
                meetingId: meeting.id,
                page: "1",
                limit: "25",
            }).toString()}`,
        );
        if (recRes.ok) {
            const recPayload = (await recRes.json()) as {
                data?: { items: AttendanceRecordDto[] };
            };
            if (recPayload.data) {
                setAttendance(recPayload.data.items);
            }
        }
    }, [meeting.id]);

    async function runStatusTransition(
        nextStatus: "ONGOING" | "COMPLETED" | "CANCELLED",
        reason?: string,
    ) {
        setErrorMsg(null);
        setSavingTransition(true);
        try {
            const res = await fetch(`${ROUTES.api.meetings}/${meeting.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status: nextStatus,
                    ...(reason ? { reason } : {}),
                    ...(isSuperAdmin ? { breakGlass: true } : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { meeting: MeetingDetailDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.meeting) {
                setErrorMsg(payload.error?.message ?? "Failed to update meeting status.");
                return;
            }
            setMeeting(payload.data.meeting);
            setBgTransition(null);
            setCancelOpen(false);
            setCancelReason("");
            toast.success(`Meeting status updated to ${nextStatus}.`);
        } finally {
            setSavingTransition(false);
        }
    }

    async function handleSaveMinutes(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);
        if (isSuperAdmin && minutesBgReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass override requires at least 10 characters.");
            return;
        }
        setSavingMinutes(true);
        try {
            const res = await fetch(`${ROUTES.api.meetings}/${meeting.id}/minutes`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    minutesHtml: minutesDraft.trim() || null,
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: minutesBgReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { meeting: MeetingDetailDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.meeting) {
                setErrorMsg(payload.error?.message ?? "Failed to save meeting minutes.");
                return;
            }
            setMeeting(payload.data.meeting);
            setMinutesDraft(payload.data.meeting.minutesHtml ?? "");
            setMinutesBgReason("");
            setEditingMinutes(false);
            toast.success("Minutes of Meeting saved.");
        } finally {
            setSavingMinutes(false);
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
                    meetingId: meeting.id,
                    label: cpLabel,
                    audienceScope: "OFFICERS_ONLY",
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
            toast.success(`Officer checkpoint "${cpLabel.trim()}" created.`);
            setCpLabel("");
            setShowAddCp(false);
            await refreshMeetingBundle();
        } finally {
            setSavingCp(false);
        }
    }

    async function handleToggleCheckpoint(cp: CheckpointDto, nextStatus: "OPEN" | "CLOSED") {
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
            await refreshMeetingBundle();
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
                setErrorMsg(payload.error?.message ?? "Failed to save officer attendance.");
                return;
            }
            toast.success(isEdit ? "Attendance record updated." : "Officer attendance logged.");
            setOverrideMode(null);
            setOverrideRecord(null);
            setOverrideStudentId("");
            setOverrideReason("");
            await refreshMeetingBundle();
        } finally {
            setSavingOverride(false);
        }
    }

    const minCancelLen = isSuperAdmin ? 10 : 5;
    const minOverrideLen = isSuperAdmin ? 10 : 5;
    const exportHref = `${ROUTES.api.attendance.export}?${new URLSearchParams({ meetingId: meeting.id }).toString()}`;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
                <Link
                    href={ROUTES.workspace.meetings}
                    className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    <span>Back to Officer Meetings</span>
                </Link>

                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <MeetingStatusBadge status={meeting.status} />
                            <Badge variant="neutral" className="font-mono">
                                {meeting.academicTerm.code}
                            </Badge>
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">
                                Start: {formatManilaTimestamp(meeting.scheduledStartAt)}
                            </span>
                            {meeting.scheduledEndAt ? (
                                <span className="font-mono">
                                    End: {formatManilaTimestamp(meeting.scheduledEndAt)}
                                </span>
                            ) : null}
                            {meeting.locationOrLink ? (
                                <span className="inline-flex items-center gap-1 text-foreground">
                                    <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    {meeting.locationOrLink}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    {canManage ? (
                        <div className="flex flex-wrap gap-2">
                            {(!isLocked || isSuperAdmin) ? (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setEditOpen(true)}
                                >
                                    <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    <span>Edit Details</span>
                                </Button>
                            ) : null}
                            {meeting.status === "SCHEDULED" ? (
                                <>
                                    <Button
                                        type="button"
                                        size="sm"
                                        disabled={savingTransition}
                                        onClick={() => {
                                            if (isSuperAdmin) {
                                                setBgTransition({
                                                    actionLabel: "MEETING_STARTED",
                                                    status: "ONGOING",
                                                });
                                            } else {
                                                void runStatusTransition("ONGOING");
                                            }
                                        }}
                                    >
                                        <PlayCircle
                                            className="size-3.5"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        <span>Start Meeting</span>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        disabled={savingTransition}
                                        onClick={() => setCancelOpen((v) => !v)}
                                    >
                                        <Ban className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                        <span>Cancel Meeting</span>
                                    </Button>
                                </>
                            ) : null}
                            {meeting.status === "ONGOING" ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() => {
                                        if (isSuperAdmin) {
                                            setBgTransition({
                                                actionLabel: "MEETING_COMPLETED",
                                                status: "COMPLETED",
                                            });
                                        } else {
                                            void runStatusTransition("COMPLETED");
                                        }
                                    }}
                                >
                                    <CheckCheck
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Complete Meeting</span>
                                </Button>
                            ) : null}
                        </div>
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

            {canManage && cancelOpen && meeting.status === "SCHEDULED" ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Cancel Officer Meeting</CardTitle>
                        <CardDescription>
                            Provide a mandatory cancellation reason ({minCancelLen}+ characters).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void runStatusTransition("CANCELLED", cancelReason.trim());
                            }}
                            className="flex flex-col gap-3"
                        >
                            <Input
                                aria-label="Cancellation reason"
                                required
                                placeholder="Explain why this officer meeting is being cancelled..."
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="submit"
                                    variant="destructive"
                                    size="sm"
                                    disabled={
                                        savingTransition || cancelReason.trim().length < minCancelLen
                                    }
                                >
                                    {savingTransition ? "Cancelling..." : "Confirm Cancellation"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCancelOpen(false)}
                                >
                                    Keep Meeting
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Agenda</CardTitle>
                        <CardDescription>
                            Executive-authored meeting agenda (sanitized HTML).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <SafeRichTextDisplay
                            html={meeting.agendaHtml}
                            emptyLabel="No agenda has been added to this meeting yet."
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                        <div>
                            <CardTitle>Minutes of Meeting</CardTitle>
                            <CardDescription>
                                Editable by active Officers or Executives until completed.
                            </CardDescription>
                        </div>
                        {canEditMinutes && !editingMinutes ? (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    setMinutesDraft(meeting.minutesHtml ?? "");
                                    setEditingMinutes(true);
                                }}
                            >
                                <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>{meeting.hasMinutes ? "Edit Minutes" : "Write Minutes"}</span>
                            </Button>
                        ) : null}
                    </CardHeader>
                    <CardContent>
                        {editingMinutes ? (
                            <form onSubmit={handleSaveMinutes} className="flex flex-col gap-3">
                                <MeetingRichTextEditor
                                    id="meeting-minutes-editor"
                                    label="Minutes Content"
                                    value={minutesDraft}
                                    onChange={setMinutesDraft}
                                    disabled={savingMinutes}
                                    placeholder="<p>Summary of decisions and action items...</p>"
                                />
                                {isSuperAdmin ? (
                                    <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-3">
                                        <label
                                            htmlFor="minutes-bg-reason"
                                            className="flex items-center gap-1.5 text-xs font-medium text-warning"
                                        >
                                            <ShieldAlert
                                                className="size-3.5"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            Super Admin Break-Glass Reason (min 10 chars)
                                        </label>
                                        <Input
                                            id="minutes-bg-reason"
                                            required
                                            value={minutesBgReason}
                                            onChange={(e) => setMinutesBgReason(e.target.value)}
                                            placeholder="Reason for updating meeting minutes..."
                                        />
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={
                                            savingMinutes ||
                                            (isSuperAdmin && minutesBgReason.trim().length < 10)
                                        }
                                    >
                                        {savingMinutes ? "Saving..." : "Save Minutes"}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={savingMinutes}
                                        onClick={() => setEditingMinutes(false)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <SafeRichTextDisplay
                                html={meeting.minutesHtml}
                                emptyLabel="No Minutes of Meeting have been recorded yet."
                            />
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <div>
                        <CardTitle>Officer Attendance (OFFICERS ONLY)</CardTitle>
                        <CardDescription>
                            Dynamic checkpoints and attendance logs restricted strictly to active
                            Officers &amp; Executives.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <a
                            href={exportHref}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 sm:min-h-9"
                        >
                            <Download className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Export CSV</span>
                        </a>
                        {canManage ? (
                            <>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
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
                                    <UserPlus
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Manual Entry</span>
                                </Button>
                            </>
                        ) : null}
                    </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                    {canManage && isSuperAdmin ? (
                        <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                            <label
                                htmlFor="mtg-cp-bg-reason"
                                className="flex items-center gap-1.5 text-xs font-medium text-warning"
                            >
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Super Admin Break-Glass Reason (min 10 chars for checkpoint mutations)
                            </label>
                            <Input
                                id="mtg-cp-bg-reason"
                                placeholder="Explain why Super Admin is configuring or toggling this checkpoint..."
                                value={cpBgReason}
                                onChange={(e) => setCpBgReason(e.target.value)}
                            />
                        </div>
                    ) : null}

                    {canManage && showAddCp ? (
                        <form
                            onSubmit={handleCreateCheckpoint}
                            className="grid gap-3 rounded-md border border-border bg-muted/40 p-3.5 sm:grid-cols-4"
                        >
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                                <label htmlFor="mtg-cp-label" className="text-xs font-medium">
                                    Checkpoint Label
                                </label>
                                <Input
                                    id="mtg-cp-label"
                                    required
                                    placeholder="Officer Roll Call"
                                    value={cpLabel}
                                    onChange={(e) => setCpLabel(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="mtg-cp-sort" className="text-xs font-medium">
                                    Sort Order
                                </label>
                                <Input
                                    id="mtg-cp-sort"
                                    type="number"
                                    min={1}
                                    max={100}
                                    className="font-mono"
                                    value={cpSort}
                                    onChange={(e) => setCpSort(e.target.value)}
                                />
                            </div>
                            <div className="flex items-end gap-2">
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={
                                        savingCp || (isSuperAdmin && cpBgReason.trim().length < 10)
                                    }
                                >
                                    {savingCp ? "Creating..." : "Create"}
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
                        <p className="py-4 text-center text-sm text-muted-foreground">
                            No officer attendance checkpoints configured for this meeting yet.
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
                                            <Badge variant="neutral">OFFICERS ONLY</Badge>
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {cp.recordCount} logs
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {cp.status === "OPEN" && canManage ? (
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
                                            {canManage && cp.status !== "OPEN" ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void handleToggleCheckpoint(cp, "OPEN")
                                                    }
                                                >
                                                    Open
                                                </Button>
                                            ) : null}
                                            {canManage && cp.status === "OPEN" ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void handleToggleCheckpoint(cp, "CLOSED")
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

                    {canManage && overrideMode ? (
                        <form
                            onSubmit={handleOverrideSubmit}
                            className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 md:grid-cols-4"
                        >
                            {overrideMode === "create" ? (
                                <>
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="mtg-ovr-cp" className="text-xs font-medium">
                                            Checkpoint
                                        </label>
                                        <select
                                            id="mtg-ovr-cp"
                                            value={overrideCheckpointId}
                                            onChange={(e) => setOverrideCheckpointId(e.target.value)}
                                            className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
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
                                            htmlFor="mtg-ovr-student"
                                            className="text-xs font-medium"
                                        >
                                            Officer Student ID
                                        </label>
                                        <Input
                                            id="mtg-ovr-student"
                                            required
                                            className="font-mono"
                                            placeholder="2024-00002"
                                            value={overrideStudentId}
                                            onChange={(e) => setOverrideStudentId(e.target.value)}
                                        />
                                    </div>
                                </>
                            ) : null}

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="mtg-ovr-status" className="text-xs font-medium">
                                    Attendance Status
                                </label>
                                <select
                                    id="mtg-ovr-status"
                                    value={overrideStatus}
                                    onChange={(e) =>
                                        setOverrideStatus(e.target.value as AttendanceStatus)
                                    }
                                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
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
                                <label htmlFor="mtg-ovr-reason" className="text-xs font-medium">
                                    Audit Reason (min {minOverrideLen} chars)
                                </label>
                                <Input
                                    id="mtg-ovr-reason"
                                    required
                                    placeholder="Verified present at roll call / excused notice..."
                                    value={overrideReason}
                                    onChange={(e) => setOverrideReason(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-wrap gap-2 md:col-span-4">
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={
                                        savingOverride ||
                                        overrideReason.trim().length < minOverrideLen
                                    }
                                >
                                    {savingOverride ? "Saving..." : "Save Attendance"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setOverrideMode(null);
                                        setOverrideRecord(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    ) : null}

                    {attendance.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                            No officer attendance records logged yet.
                        </p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                                        <th className="px-4 py-2.5">Officer</th>
                                        <th className="px-4 py-2.5">Checkpoint</th>
                                        <th className="px-4 py-2.5">Status</th>
                                        <th className="px-4 py-2.5">Recorded (PHT)</th>
                                        {canManage ? <th className="px-4 py-2.5 text-right">Edit</th> : null}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {attendance.map((rec) => (
                                        <tr key={rec.id} className="hover:bg-muted/30">
                                            <td className="px-4 py-2.5">
                                                <div className="font-medium text-foreground">
                                                    {rec.fullName}
                                                </div>
                                                <div className="font-mono text-xs text-muted-foreground">
                                                    {rec.studentIdNumber}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-foreground">
                                                {rec.checkpointLabel}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <AttendanceBadge status={rec.status} />
                                            </td>
                                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                                {formatManilaTimestamp(rec.recordedAt)}
                                            </td>
                                            {canManage ? (
                                                <td className="px-4 py-2.5 text-right">
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
                                                        Override
                                                    </Button>
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <div>
                        <CardTitle>Minutes &amp; Attachments</CardTitle>
                        <CardDescription>
                            Files uploaded here route automatically to{" "}
                            <span className="font-mono text-xs">
                                {meeting.academicTerm.name} / Minutes / General
                            </span>
                            .
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setUploadMode("external")}
                        >
                            <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Link Drive URL</span>
                        </Button>
                        <Button type="button" size="sm" onClick={() => setUploadMode("upload")}>
                            <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Upload Minutes</span>
                        </Button>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {docs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 border-t border-border px-6 py-10 text-center">
                            <FolderOpen
                                className="size-10 text-muted-foreground"
                                strokeWidth={1.5}
                                aria-hidden="true"
                            />
                            <p className="text-sm text-muted-foreground">
                                No minutes or attachment files linked to this meeting yet.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border-t border-border">
                            <table className="w-full min-w-[660px] border-collapse text-left text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                                        <th className="px-4 py-3">Document</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Source</th>
                                        <th className="px-4 py-3">Uploaded (PHT)</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {docs.map((doc) => (
                                        <tr key={doc.id} className="hover:bg-muted/30">
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-foreground">
                                                    {doc.title}
                                                </div>
                                                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                                    {doc.drivePathDisplay}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-foreground">
                                                {doc.documentType.name}
                                            </td>
                                            <td className="px-4 py-3">
                                                <DocumentStatusBadge status={doc.status} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col items-start gap-1">
                                                    <StorageModeBadge mode={doc.storageMode} />
                                                    <span className="font-mono text-xs text-muted-foreground">
                                                        {formatFileSizeBytes(doc.fileSizeBytes)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                {formatManilaTimestamp(doc.createdAt)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setSelectedDoc(doc)}
                                                >
                                                    Inspect
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <MeetingFormDialog
                open={editOpen}
                userRole={userRole}
                initialMeeting={meeting}
                onClose={() => setEditOpen(false)}
                onSuccess={(updated) => {
                    setEditOpen(false);
                    setMeeting(updated);
                }}
            />

            <BreakGlassDialog
                open={Boolean(bgTransition)}
                actionLabel={bgTransition?.actionLabel ?? ""}
                targetLabel={meeting.title}
                submitting={savingTransition}
                onCancel={() => setBgTransition(null)}
                onConfirm={(reason) => {
                    if (!bgTransition) return;
                    return runStatusTransition(bgTransition.status, reason);
                }}
            />

            <DocumentUploadDialog
                open={uploadMode !== null}
                initialMode={uploadMode ?? "upload"}
                userRole={userRole}
                documentTypes={documentTypes}
                activeTerm={activeTerm}
                lockedMeeting={{
                    id: meeting.id,
                    title: meeting.title,
                    status: meeting.status,
                    academicTermCode: meeting.academicTerm.code,
                    academicTermName: meeting.academicTerm.name,
                    academicTermStatus: meeting.academicTerm.status,
                }}
                defaultDocTypeSlug="minutes"
                maxUploadSizeBytes={maxUploadSizeBytes}
                onClose={() => setUploadMode(null)}
                onSuccess={() => {
                    setUploadMode(null);
                    void refreshMeetingBundle();
                }}
            />

            <DocumentDetailDrawer
                document={selectedDoc}
                userRole={userRole}
                driveShareMode={driveShareMode}
                onClose={() => setSelectedDoc(null)}
                onUpdated={(updated) => {
                    setSelectedDoc(updated);
                    setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                }}
            />
        </div>
    );
}
