"use client";

import { useState, type FormEvent } from "react";
import {
    AlertCircle,
    AlertTriangle,
    Crown,
    Lock,
    Pencil,
    Plus,
    ShieldAlert,
    UserMinus,
    UserPlus,
    Users,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import type {
    EligibleOfficerOption,
    EventCommitteeDto,
    EventStatus,
} from "@/app/api/events/_lib/validation";
import { Badge } from "@/components/ui/badge";
import { BreakGlassModal } from "@/components/ui/break-glass-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface CommitteesTabProps {
    eventId: string;
    eventTitle: string;
    eventStatus: EventStatus;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    actorId: string;
    userRole: SystemRole;
    committees: EventCommitteeDto[];
    eligibleOfficers: EligibleOfficerOption[];
    onCommitteesChange: (next: EventCommitteeDto[]) => void;
}

export function CommitteesTab({
    eventId,
    eventTitle,
    eventStatus,
    termStatus,
    actorId,
    userRole,
    committees,
    eligibleOfficers,
    onCommitteesChange,
}: CommitteesTabProps) {
    const isExecutive = userRole === "EXECUTIVE";
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isLocked =
        termStatus === "CLOSED" || eventStatus === "COMPLETED" || eventStatus === "REJECTED";
    const isPreApproval =
        eventStatus === "DRAFT" ||
        eventStatus === "PENDING_REVIEW" ||
        eventStatus === "NEEDS_REVISION";

    const canManageCommittees = (isExecutive && !isLocked && !isPreApproval) || isSuperAdmin;

    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [newHeadId, setNewHeadId] = useState(eligibleOfficers[0]?.userId ?? "");
    const [savingCreate, setSavingCreate] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [editHeadId, setEditHeadId] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);

    const [rosterCommitteeId, setRosterCommitteeId] = useState<string | null>(null);
    const [selectedMemberId, setSelectedMemberId] = useState("");
    const [savingRoster, setSavingRoster] = useState(false);

    const [pendingBg, setPendingBg] = useState<{
        actionLabel: string;
        targetLabel: string;
        run: (reason: string) => Promise<void>;
    } | null>(null);

    if (isPreApproval) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <Lock className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                        Committees unlock once this event proposal is APPROVED.
                    </p>
                    <p className="max-w-md text-xs text-muted-foreground">
                        Per SYComP governance policy (BR-COM-01), Executives create event-scoped
                        committees and appoint one active Officer Head after proposal approval.
                    </p>
                </CardContent>
            </Card>
        );
    }

    async function executeCreate(breakGlassReason?: string) {
        setErrorMsg(null);
        setSavingCreate(true);
        try {
            const res = await fetch(`${ROUTES.api.events}/${eventId}/committees`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: newName.trim(),
                    description: newDescription.trim() || null,
                    headUserId: newHeadId,
                    ...(breakGlassReason
                        ? { breakGlass: true, reason: breakGlassReason }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { committees: EventCommitteeDto[] };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to create committee.");
                return;
            }
            onCommitteesChange(payload.data.committees);
            setNewName("");
            setNewDescription("");
            setShowCreate(false);
            setPendingBg(null);
            toast.success("Event committee created.");
        } catch {
            setErrorMsg("Network error while creating committee. Please try again.");
        } finally {
            setSavingCreate(false);
        }
    }

    function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!newName.trim() || !newHeadId) return;
        if (isSuperAdmin) {
            setPendingBg({
                actionLabel: "COMMITTEE_CREATED",
                targetLabel: `${newName.trim()} (${eventTitle})`,
                run: (reason) => executeCreate(reason),
            });
            return;
        }
        void executeCreate();
    }

    async function executeUpdate(committeeId: string, breakGlassReason?: string) {
        setErrorMsg(null);
        setSavingEdit(true);
        try {
            const res = await fetch(`${ROUTES.api.events}/${eventId}/committees/${committeeId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: editName.trim(),
                    description: editDescription.trim() || null,
                    headUserId: editHeadId,
                    ...(breakGlassReason
                        ? { breakGlass: true, reason: breakGlassReason }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { committees: EventCommitteeDto[] };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to update committee.");
                return;
            }
            onCommitteesChange(payload.data.committees);
            setEditingId(null);
            setPendingBg(null);
            toast.success("Committee updated.");
        } catch {
            setErrorMsg("Network error while updating committee. Please try again.");
        } finally {
            setSavingEdit(false);
        }
    }

    function handleEditSubmit(event: FormEvent<HTMLFormElement>, committee: EventCommitteeDto) {
        event.preventDefault();
        if (!editName.trim() || !editHeadId) return;
        const headChanged = editHeadId !== committee.head.id;
        if (isSuperAdmin) {
            setPendingBg({
                actionLabel: headChanged ? "COMMITTEE_HEAD_ASSIGNED" : "COMMITTEE_UPDATED",
                targetLabel: `${committee.name} (${eventTitle})`,
                run: (reason) => executeUpdate(committee.id, reason),
            });
            return;
        }
        void executeUpdate(committee.id);
    }

    async function executeMemberMutation(
        committee: EventCommitteeDto,
        method: "POST" | "DELETE",
        userId: string,
        breakGlassReason?: string,
    ) {
        setErrorMsg(null);
        setSavingRoster(true);
        try {
            const res = await fetch(
                `${ROUTES.api.events}/${eventId}/committees/${committee.id}/members`,
                {
                    method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        ...(breakGlassReason
                            ? { breakGlass: true, reason: breakGlassReason }
                            : {}),
                    }),
                },
            );
            const payload = (await res.json()) as {
                data?: { committees: EventCommitteeDto[] };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to update committee roster.");
                return;
            }
            onCommitteesChange(payload.data.committees);
            setSelectedMemberId("");
            setPendingBg(null);
            toast.success(
                method === "POST"
                    ? "Officer added to committee roster."
                    : "Officer removed from committee roster.",
            );
        } catch {
            setErrorMsg("Network error while updating committee roster. Please try again.");
        } finally {
            setSavingRoster(false);
        }
    }

    function handleRemoveMember(committee: EventCommitteeDto, userId: string, memberName: string) {
        if (isSuperAdmin) {
            setPendingBg({
                actionLabel: "COMMITTEE_MEMBER_REMOVED",
                targetLabel: `${memberName} from ${committee.name}`,
                run: (reason) => executeMemberMutation(committee, "DELETE", userId, reason),
            });
            return;
        }
        void executeMemberMutation(committee, "DELETE", userId);
    }

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

            {isLocked && !isSuperAdmin ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>
                        Historical archive: committees and rosters are read-only because this event
                        or academic term is finalized.
                    </span>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Event Committees</h2>
                    <p className="text-xs text-muted-foreground">
                        Scoped strictly to this event with one active Officer or Executive Head per
                        committee (BR-COM-02).
                    </p>
                </div>
                {canManageCommittees ? (
                    <Button
                        type="button"
                        size="sm"
                        disabled={eligibleOfficers.length === 0}
                        onClick={() => {
                            setNewHeadId((prev) => prev || eligibleOfficers[0]?.userId || "");
                            setShowCreate((v) => !v);
                        }}
                    >
                        {isSuperAdmin ? (
                            <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                            <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        )}
                        <span>{isSuperAdmin ? "Create Committee (Break-Glass)" : "Add Committee"}</span>
                    </Button>
                ) : null}
            </div>

            {canManageCommittees && showCreate ? (
                <Card>
                    <CardHeader>
                        <CardTitle>New Event Committee</CardTitle>
                        <CardDescription>
                            Assign one active Officer or Executive as Committee Head. General
                            Members are excluded.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={handleCreateSubmit}
                            className="grid gap-4 md:grid-cols-2"
                        >
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="committee-name" className="text-xs font-medium">
                                    Committee Name
                                </label>
                                <Input
                                    id="committee-name"
                                    required
                                    maxLength={120}
                                    placeholder="e.g., Logistics & Venue"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="committee-head" className="text-xs font-medium">
                                    Committee Head (Active Officer / Executive)
                                </label>
                                <select
                                    id="committee-head"
                                    required
                                    value={newHeadId}
                                    onChange={(e) => setNewHeadId(e.target.value)}
                                    className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                                >
                                    {eligibleOfficers.map((officer) => (
                                        <option key={officer.userId} value={officer.userId}>
                                            {officer.fullName} ({officer.studentIdNumber}) —{" "}
                                            {officer.positionTitle}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5 md:col-span-2">
                                <label htmlFor="committee-desc" className="text-xs font-medium">
                                    Scope / Description (Optional)
                                </label>
                                <Input
                                    id="committee-desc"
                                    maxLength={1000}
                                    placeholder="Key responsibilities for this event..."
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-wrap gap-2 md:col-span-2">
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={savingCreate || !newName.trim() || !newHeadId}
                                >
                                    {savingCreate ? "Creating..." : "Create Committee"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowCreate(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            {committees.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Users
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            No committees have been assigned to this event yet.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {committees.map((committee) => {
                        const isOwnHead =
                            committee.head.id === actorId &&
                            committee.head.hasActiveAppointment &&
                            committee.head.accountStatus === "ACTIVE";
                        const canManageRoster =
                            isSuperAdmin || (!isLocked && (isExecutive || isOwnHead));
                        const isEditing = editingId === committee.id;
                        const isRosterOpen = rosterCommitteeId === committee.id;

                        const existingMemberIds = new Set([
                            committee.head.id,
                            ...committee.members.map((m) => m.userId),
                        ]);
                        const addableOfficers = eligibleOfficers.filter(
                            (o) => !existingMemberIds.has(o.userId),
                        );

                        const progressPct =
                            committee.taskTotal > 0
                                ? Math.round((committee.taskDone / committee.taskTotal) * 100)
                                : 0;

                        return (
                            <Card key={committee.id} className="flex flex-col">
                                <CardHeader className="flex flex-row items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CardTitle className="truncate">
                                                {committee.name}
                                            </CardTitle>
                                            {isOwnHead ? (
                                                <Badge variant="brand">
                                                    <Crown
                                                        className="size-3"
                                                        strokeWidth={1.75}
                                                        aria-hidden="true"
                                                    />
                                                    Your Committee
                                                </Badge>
                                            ) : null}
                                        </div>
                                        {committee.description ? (
                                            <CardDescription className="mt-1">
                                                {committee.description}
                                            </CardDescription>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-1.5">
                                        {canManageCommittees ? (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => {
                                                    if (isEditing) {
                                                        setEditingId(null);
                                                    } else {
                                                        setEditingId(committee.id);
                                                        setEditName(committee.name);
                                                        setEditDescription(
                                                            committee.description ?? "",
                                                        );
                                                        setEditHeadId(committee.head.id);
                                                    }
                                                }}
                                            >
                                                <Pencil
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                <span>Edit / Head</span>
                                            </Button>
                                        ) : null}
                                        {canManageRoster ? (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => {
                                                    if (isRosterOpen) {
                                                        setRosterCommitteeId(null);
                                                    } else {
                                                        setRosterCommitteeId(committee.id);
                                                        setSelectedMemberId(
                                                            addableOfficers[0]?.userId ?? "",
                                                        );
                                                    }
                                                }}
                                            >
                                                <UserPlus
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                <span>Manage Roster</span>
                                            </Button>
                                        ) : null}
                                    </div>
                                </CardHeader>

                                <CardContent className="flex flex-1 flex-col gap-4">
                                    {committee.headNeedsReassignment ? (
                                        <div
                                            role="alert"
                                            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs font-medium text-warning"
                                        >
                                            <AlertTriangle
                                                className="mt-0.5 size-4 shrink-0"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            <span>
                                                Committee Head is inactive or no longer appointed.
                                                An Executive should reassign this committee head
                                                (BR-COM-05).
                                            </span>
                                        </div>
                                    ) : null}

                                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                                <Crown
                                                    className="size-3.5 text-primary dark:text-brand-accent"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                Committee Head
                                            </span>
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {committee.head.studentIdNumber}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-sm font-medium text-foreground">
                                            {committee.head.fullName}
                                            {committee.head.positionTitle ? (
                                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                                    &bull; {committee.head.positionTitle}
                                                </span>
                                            ) : null}
                                        </p>
                                    </div>

                                    {isEditing && canManageCommittees ? (
                                        <form
                                            onSubmit={(e) => handleEditSubmit(e, committee)}
                                            className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3"
                                        >
                                            <div className="flex flex-col gap-1">
                                                <label
                                                    htmlFor={`edit-name-${committee.id}`}
                                                    className="text-xs font-medium"
                                                >
                                                    Committee Name
                                                </label>
                                                <Input
                                                    id={`edit-name-${committee.id}`}
                                                    required
                                                    maxLength={120}
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label
                                                    htmlFor={`edit-head-${committee.id}`}
                                                    className="text-xs font-medium"
                                                >
                                                    Reassign Committee Head
                                                </label>
                                                <select
                                                    id={`edit-head-${committee.id}`}
                                                    required
                                                    value={editHeadId}
                                                    onChange={(e) => setEditHeadId(e.target.value)}
                                                    className="min-h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground sm:min-h-10"
                                                >
                                                    {!eligibleOfficers.some(
                                                        (o) => o.userId === committee.head.id,
                                                    ) ? (
                                                        <option value={committee.head.id}>
                                                            {committee.head.fullName} (Current —
                                                            Inactive)
                                                        </option>
                                                    ) : null}
                                                    {eligibleOfficers.map((officer) => (
                                                        <option
                                                            key={officer.userId}
                                                            value={officer.userId}
                                                        >
                                                            {officer.fullName} (
                                                            {officer.studentIdNumber}) —{" "}
                                                            {officer.positionTitle}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label
                                                    htmlFor={`edit-desc-${committee.id}`}
                                                    className="text-xs font-medium"
                                                >
                                                    Description
                                                </label>
                                                <Input
                                                    id={`edit-desc-${committee.id}`}
                                                    maxLength={1000}
                                                    value={editDescription}
                                                    onChange={(e) =>
                                                        setEditDescription(e.target.value)
                                                    }
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    type="submit"
                                                    size="sm"
                                                    disabled={savingEdit || !editName.trim()}
                                                >
                                                    {savingEdit ? "Saving..." : "Save Changes"}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </form>
                                    ) : null}

                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-medium text-muted-foreground">
                                                Officer Roster ({committee.members.length})
                                            </span>
                                            <span className="font-mono text-muted-foreground">
                                                Tasks: {committee.taskDone}/{committee.taskTotal} (
                                                {progressPct}%)
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                            <div
                                                className="h-full rounded-full bg-primary transition-all"
                                                style={{ width: `${progressPct}%` }}
                                            />
                                        </div>

                                        {committee.members.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">
                                                No additional officer members assigned yet.
                                            </p>
                                        ) : (
                                            <ul className="flex flex-col gap-1.5">
                                                {committee.members.map((member) => (
                                                    <li
                                                        key={member.userId}
                                                        className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
                                                    >
                                                        <div className="min-w-0">
                                                            <span className="font-medium text-foreground">
                                                                {member.fullName}
                                                            </span>
                                                            <span className="ml-2 font-mono text-muted-foreground">
                                                                {member.studentIdNumber}
                                                            </span>
                                                        </div>
                                                        {canManageRoster ? (
                                                            <button
                                                                type="button"
                                                                disabled={savingRoster}
                                                                aria-label={`Remove ${member.fullName} from ${committee.name}`}
                                                                onClick={() =>
                                                                    handleRemoveMember(
                                                                        committee,
                                                                        member.userId,
                                                                        member.fullName,
                                                                    )
                                                                }
                                                                className="inline-flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 sm:size-7"
                                                            >
                                                                <UserMinus
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                            </button>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {isRosterOpen && canManageRoster ? (
                                            <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 sm:flex-row sm:items-center">
                                                {addableOfficers.length === 0 ? (
                                                    <span className="text-xs text-muted-foreground">
                                                        All active term officers are already
                                                        assigned to this committee.
                                                    </span>
                                                ) : (
                                                    <>
                                                        <select
                                                            aria-label={`Add officer to ${committee.name}`}
                                                            value={
                                                                selectedMemberId ||
                                                                addableOfficers[0]?.userId ||
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                setSelectedMemberId(e.target.value)
                                                            }
                                                            className="min-h-11 flex-1 rounded-md border border-border bg-card px-3 text-xs text-foreground sm:min-h-9"
                                                        >
                                                            {addableOfficers.map((officer) => (
                                                                <option
                                                                    key={officer.userId}
                                                                    value={officer.userId}
                                                                >
                                                                    {officer.fullName} (
                                                                    {officer.studentIdNumber}) —{" "}
                                                                    {officer.positionTitle}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            disabled={savingRoster}
                                                            onClick={() => {
                                                                const target =
                                                                    selectedMemberId ||
                                                                    addableOfficers[0]?.userId ||
                                                                    "";
                                                                if (!target) return;
                                                                setSelectedMemberId(target);
                                                                if (isSuperAdmin) {
                                                                    setPendingBg({
                                                                        actionLabel:
                                                                            "COMMITTEE_MEMBER_ADDED",
                                                                        targetLabel: `${committee.name} (${eventTitle})`,
                                                                        run: (reason) =>
                                                                            executeMemberMutation(
                                                                                committee,
                                                                                "POST",
                                                                                target,
                                                                                reason,
                                                                            ),
                                                                    });
                                                                } else {
                                                                    void executeMemberMutation(
                                                                        committee,
                                                                        "POST",
                                                                        target,
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            Add Officer
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <BreakGlassModal
                open={Boolean(pendingBg)}
                actionLabel={pendingBg?.actionLabel ?? ""}
                targetLabel={pendingBg?.targetLabel ?? ""}
                submitting={savingCreate || savingEdit || savingRoster}
                onCancel={() => setPendingBg(null)}
                onConfirm={(reason) => pendingBg?.run(reason)}
            />
        </div>
    );
}
