"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    AlertCircle,
    Archive,
    ArrowLeft,
    CalendarClock,
    CheckCircle2,
    CheckSquare,
    ClipboardCheck,
    EyeOff,
    FileText,
    FolderOpen,
    Globe,
    Lock,
    MapPin,
    MessageSquare,
    Pencil,
    RotateCcw,
    Send,
    ShieldAlert,
    Users,
    X,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import type {
    EligibleOfficerOption,
    EventCommitteeDto,
    EventDetailDto,
    EventProposalDecision,
    EventProposalReviewDto,
    EventTransitionAction,
} from "@/app/api/events/_lib/validation";
import { RichTextEditor, SafeHtmlDisplay } from "@/components/editor/rich-text-editor";
import { EventAttendanceTab } from "@/components/event-hub/attendance-tab";
import { CommitteesTab } from "@/components/event-hub/committees-tab";
import { EventDocumentsTab } from "@/components/event-hub/documents-tab";
import { EventStatusBadge } from "@/components/event-hub/event-status-badge";
import { Badge } from "@/components/ui/badge";
import { BreakGlassModal } from "@/components/ui/break-glass-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type EventHubTabId = "overview" | "committees" | "tasks" | "attendance" | "documents";

const VALID_TABS = new Set<EventHubTabId>([
    "overview",
    "committees",
    "tasks",
    "attendance",
    "documents",
]);

function toLocalDateTimeInput(iso: string): string {
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

function decisionBadge(decision: EventProposalDecision) {
    switch (decision) {
        case "APPROVED":
            return <Badge variant="brand">APPROVED</Badge>;
        case "REQUEST_REVISION":
            return <Badge variant="warning">REVISION REQUESTED</Badge>;
        case "REJECTED":
            return <Badge variant="destructive">REJECTED</Badge>;
        case "UNPUBLISHED":
            return <Badge variant="warning">UNPUBLISHED</Badge>;
        default:
            return <Badge variant="neutral">COMMENT</Badge>;
    }
}

export interface EventHubWorkspaceProps {
    actorId: string;
    userRole: SystemRole;
    initialEvent: EventDetailDto;
    initialReviews: EventProposalReviewDto[];
    initialCommittees: EventCommitteeDto[];
    eligibleOfficers: EligibleOfficerOption[];
}

export function EventHubWorkspace({
    actorId,
    userRole,
    initialEvent,
    initialReviews,
    initialCommittees,
    eligibleOfficers,
}: EventHubWorkspaceProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const rawTab = searchParams.get("tab") as EventHubTabId | null;
    const activeTab: EventHubTabId = rawTab && VALID_TABS.has(rawTab) ? rawTab : "overview";

    const [event, setEvent] = useState<EventDetailDto>(initialEvent);
    const [reviews, setReviews] = useState<EventProposalReviewDto[]>(initialReviews);
    const [committees, setCommittees] = useState<EventCommitteeDto[]>(initialCommittees);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const isExecutive = userRole === "EXECUTIVE";
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isAuthor = event.createdBy?.id === actorId;
    const isLocked =
        event.academicTerm.status === "CLOSED" ||
        event.status === "COMPLETED" ||
        event.status === "REJECTED";
    const isAuthorEditableStatus =
        event.status === "DRAFT" || event.status === "NEEDS_REVISION";

    const canEdit =
        isSuperAdmin ||
        (!isLocked &&
            ((isAuthorEditableStatus && (isAuthor || isExecutive)) ||
                (!isAuthorEditableStatus && isExecutive)));

    const canSubmitOrResubmit =
        !isLocked && isAuthorEditableStatus && (isAuthor || isExecutive || isSuperAdmin);
    const canReviewDecide = !isLocked && event.status === "PENDING_REVIEW" && (isExecutive || isSuperAdmin);
    const canPublish = !isLocked && event.status === "APPROVED" && (isExecutive || isSuperAdmin);
    const canUnpublishOrComplete =
        !isLocked && event.status === "PUBLISHED" && (isExecutive || isSuperAdmin);

    // Edit modal state
    const [editOpen, setEditOpen] = useState(false);
    const [editTitle, setEditTitle] = useState(event.title);
    const [editDescription, setEditDescription] = useState(event.descriptionHtml);
    const [editPublicSummary, setEditPublicSummary] = useState(event.publicSummary ?? "");
    const [editVenue, setEditVenue] = useState(event.venue ?? "");
    const [editAudience, setEditAudience] = useState(event.targetAudience ?? "");
    const [editStart, setEditStart] = useState(toLocalDateTimeInput(event.startAt));
    const [editEnd, setEditEnd] = useState(toLocalDateTimeInput(event.endAt));
    const [editBgReason, setEditBgReason] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);

    // Transition prompt state (feedback / publish confirmation)
    const [transitionPrompt, setTransitionPrompt] = useState<{
        action: EventTransitionAction;
        title: string;
        description: string;
        requiresNote: boolean;
        isPublish?: boolean;
        destructive?: boolean;
    } | null>(null);
    const [transitionNote, setTransitionNote] = useState("");
    const [publishVenue, setPublishVenue] = useState(event.venue ?? "");
    const [publishSummary, setPublishSummary] = useState(event.publicSummary ?? "");
    const [transitionBgReason, setTransitionBgReason] = useState("");
    const [savingTransition, setSavingTransition] = useState(false);

    // Break-glass dialog for one-click transitions by SUPER_ADMIN
    const [bgAction, setBgAction] = useState<{
        actionLabel: string;
        action: EventTransitionAction;
    } | null>(null);

    // Review comment form
    const [commentText, setCommentText] = useState("");
    const [commentBgReason, setCommentBgReason] = useState("");
    const [savingComment, setSavingComment] = useState(false);

    function selectTab(tab: EventHubTabId) {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "overview") {
            params.delete("tab");
        } else {
            params.set("tab", tab);
        }
        const qs = params.toString();
        router.replace(
            `${ROUTES.workspace.eventDetail(event.slug)}${qs ? `?${qs}` : ""}`,
            { scroll: false },
        );
    }

    function openEditModal() {
        setErrorMsg(null);
        setEditTitle(event.title);
        setEditDescription(event.descriptionHtml);
        setEditPublicSummary(event.publicSummary ?? "");
        setEditVenue(event.venue ?? "");
        setEditAudience(event.targetAudience ?? "");
        setEditStart(toLocalDateTimeInput(event.startAt));
        setEditEnd(toLocalDateTimeInput(event.endAt));
        setEditBgReason("");
        setEditOpen(true);
    }

    async function handleEditSave(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErrorMsg(null);
        if (isSuperAdmin && editBgReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass edits require at least 10 characters.");
            return;
        }
        setSavingEdit(true);
        try {
            const res = await fetch(`${ROUTES.api.events}/${event.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: editTitle.trim(),
                    descriptionHtml: editDescription,
                    publicSummary: editPublicSummary.trim() || null,
                    venue: editVenue.trim() || null,
                    targetAudience: editAudience.trim() || null,
                    startAt: `${editStart}:00+08:00`,
                    endAt: `${editEnd}:00+08:00`,
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: editBgReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { event: EventDetailDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.event) {
                setErrorMsg(payload.error?.message ?? "Failed to update event.");
                return;
            }
            setEvent(payload.data.event);
            setEditOpen(false);
            toast.success("Event details updated.");
        } catch {
            setErrorMsg("Network error while saving event changes.");
        } finally {
            setSavingEdit(false);
        }
    }

    async function executeTransition(
        action: EventTransitionAction,
        options?: {
            feedbackNote?: string;
            venue?: string;
            publicSummary?: string;
            breakGlassReason?: string;
        },
    ) {
        setErrorMsg(null);
        setSavingTransition(true);
        try {
            const res = await fetch(`${ROUTES.api.events}/${event.id}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    ...(options?.feedbackNote ? { feedbackNote: options.feedbackNote } : {}),
                    ...(options?.venue !== undefined ? { venue: options.venue } : {}),
                    ...(options?.publicSummary !== undefined
                        ? { publicSummary: options.publicSummary }
                        : {}),
                    ...(isSuperAdmin
                        ? {
                              breakGlass: true,
                              reason:
                                  options?.breakGlassReason ??
                                  options?.feedbackNote ??
                                  "",
                          }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { event: EventDetailDto; reviews: EventProposalReviewDto[] };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.event) {
                setErrorMsg(payload.error?.message ?? "Failed to update event lifecycle status.");
                return;
            }
            setEvent(payload.data.event);
            setReviews(payload.data.reviews);
            setTransitionPrompt(null);
            setTransitionNote("");
            setTransitionBgReason("");
            setBgAction(null);
            toast.success(`Event status updated to ${payload.data.event.status}.`);
        } catch {
            setErrorMsg("Network error while transitioning event status.");
        } finally {
            setSavingTransition(false);
        }
    }

    function triggerSimpleTransition(action: EventTransitionAction, auditLabel: string) {
        if (isSuperAdmin) {
            setBgAction({ actionLabel: auditLabel, action });
            return;
        }
        void executeTransition(action);
    }

    async function handleCommentSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErrorMsg(null);
        if (isSuperAdmin && commentBgReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass comments require a 10+ char audit reason.");
            return;
        }
        setSavingComment(true);
        try {
            const res = await fetch(`${ROUTES.api.events}/${event.id}/reviews`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    feedbackNote: commentText.trim(),
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: commentBgReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { reviews: EventProposalReviewDto[] };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to post review comment.");
                return;
            }
            setReviews(payload.data.reviews);
            setCommentText("");
            setCommentBgReason("");
            toast.success("Review comment added.");
        } catch {
            setErrorMsg("Network error while posting review comment.");
        } finally {
            setSavingComment(false);
        }
    }

    const tabs: Array<{
        id: EventHubTabId;
        label: string;
        icon: typeof FileText;
        count?: number;
    }> = [
        { id: "overview", label: "Overview & Proposal", icon: FileText },
        { id: "committees", label: "Committees", icon: Users, count: committees.length },
        { id: "tasks", label: "Tasks", icon: CheckSquare, count: event.taskCount },
        { id: "attendance", label: "Attendance", icon: ClipboardCheck, count: event.checkpointCount },
        { id: "documents", label: "Documents", icon: FolderOpen, count: event.documentCount },
    ];

    const committeesUnlocked =
        event.status === "APPROVED" ||
        event.status === "PUBLISHED" ||
        event.status === "COMPLETED";

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Link
                        href={ROUTES.workspace.events}
                        className="inline-flex min-h-11 items-center gap-1.5 font-medium hover:text-foreground sm:min-h-0"
                    >
                        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Events &amp; Proposals</span>
                    </Link>
                    <span aria-hidden="true">/</span>
                    <span className="font-mono">{event.academicTerm.code}</span>
                    {event.revisionCount > 0 ? (
                        <>
                            <span aria-hidden="true">&bull;</span>
                            <span className="font-mono">Rev #{event.revisionCount}</span>
                        </>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <EventStatusBadge status={event.status} />
                            <Badge variant="neutral" className="font-mono">
                                {event.academicTerm.code}
                            </Badge>
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1 font-mono">
                                <CalendarClock
                                    className="size-3.5"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                                {formatManilaTimestamp(event.startAt)} &ndash;{" "}
                                {formatManilaTimestamp(event.endAt)}
                            </span>
                            {event.venue ? (
                                <span className="inline-flex items-center gap-1 text-foreground">
                                    <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    {event.venue}
                                </span>
                            ) : null}
                            {event.targetAudience ? (
                                <span>Audience: {event.targetAudience}</span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {canEdit ? (
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={openEditModal}
                            >
                                <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>
                                    {isAuthorEditableStatus ? "Edit Proposal" : "Edit Details"}
                                </span>
                            </Button>
                        ) : null}

                        {canSubmitOrResubmit ? (
                            <Button
                                type="button"
                                size="sm"
                                disabled={savingTransition}
                                onClick={() =>
                                    triggerSimpleTransition(
                                        event.status === "DRAFT" ? "SUBMIT" : "RESUBMIT",
                                        event.status === "DRAFT"
                                            ? "EVENT_SUBMITTED"
                                            : "EVENT_RESUBMITTED",
                                    )
                                }
                            >
                                <Send className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>
                                    {event.status === "DRAFT"
                                        ? "Submit for Review"
                                        : "Resubmit for Review"}
                                </span>
                            </Button>
                        ) : null}

                        {canReviewDecide ? (
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() =>
                                        triggerSimpleTransition("APPROVE", "EVENT_APPROVED")
                                    }
                                >
                                    <CheckCircle2
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Approve</span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() => {
                                        setTransitionNote("");
                                        setTransitionBgReason("");
                                        setTransitionPrompt({
                                            action: "REQUEST_REVISION",
                                            title: "Request Proposal Revision",
                                            description:
                                                "Provide clear revision feedback so the author can update and resubmit.",
                                            requiresNote: true,
                                        });
                                    }}
                                >
                                    <RotateCcw
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Request Revision</span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() => {
                                        setTransitionNote("");
                                        setTransitionBgReason("");
                                        setTransitionPrompt({
                                            action: "REJECT",
                                            title: "Reject Event Proposal",
                                            description:
                                                "Rejected proposals become permanently read-only historical archive records.",
                                            requiresNote: true,
                                            destructive: true,
                                        });
                                    }}
                                >
                                    <XCircle
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Reject</span>
                                </Button>
                            </>
                        ) : null}

                        {canPublish ? (
                            <Button
                                type="button"
                                size="sm"
                                disabled={savingTransition}
                                onClick={() => {
                                    setPublishVenue(event.venue ?? "");
                                    setPublishSummary(event.publicSummary ?? "");
                                    setTransitionBgReason("");
                                    setTransitionPrompt({
                                        action: "PUBLISH",
                                        title: "Publish Event to Member Calendar",
                                        description:
                                            "Confirm the public venue and member-facing summary before making this event visible on /portal/calendar.",
                                        requiresNote: false,
                                        isPublish: true,
                                    });
                                }}
                            >
                                <Globe className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Publish Event</span>
                            </Button>
                        ) : null}

                        {canUnpublishOrComplete ? (
                            <>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() => {
                                        setTransitionNote("");
                                        setTransitionBgReason("");
                                        setTransitionPrompt({
                                            action: "UNPUBLISH",
                                            title: "Unpublish Event",
                                            description:
                                                "Hides this event from the Member Portal while preserving committees and recorded attendance.",
                                            requiresNote: true,
                                        });
                                    }}
                                >
                                    <EyeOff
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Unpublish</span>
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={savingTransition}
                                    onClick={() =>
                                        triggerSimpleTransition("COMPLETE", "EVENT_COMPLETED")
                                    }
                                >
                                    <Archive
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Mark Completed</span>
                                </Button>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>

            {isLocked && !isSuperAdmin ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>
                        Read-only archive: this event is{" "}
                        {event.academicTerm.status === "CLOSED"
                            ? "in a closed academic term"
                            : event.status.toLowerCase()}
                        . Operational mutations are locked except via Super Admin break-glass.
                    </span>
                </div>
            ) : null}

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

            {transitionPrompt ? (
                <Card>
                    <CardHeader>
                        <CardTitle>{transitionPrompt.title}</CardTitle>
                        <CardDescription>{transitionPrompt.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                void executeTransition(transitionPrompt.action, {
                                    feedbackNote: transitionPrompt.requiresNote
                                        ? transitionNote.trim()
                                        : undefined,
                                    venue: transitionPrompt.isPublish
                                        ? publishVenue.trim()
                                        : undefined,
                                    publicSummary: transitionPrompt.isPublish
                                        ? publishSummary.trim()
                                        : undefined,
                                    breakGlassReason: isSuperAdmin
                                        ? transitionBgReason.trim() || transitionNote.trim()
                                        : undefined,
                                });
                            }}
                            className="flex flex-col gap-3"
                        >
                            {transitionPrompt.isPublish ? (
                                <>
                                    <div className="flex flex-col gap-1.5">
                                        <label
                                            htmlFor="publish-venue"
                                            className="text-xs font-medium"
                                        >
                                            Confirmed Venue (Required)
                                        </label>
                                        <Input
                                            id="publish-venue"
                                            required
                                            maxLength={255}
                                            placeholder="e.g., HNU Barder Hall"
                                            value={publishVenue}
                                            onChange={(e) => setPublishVenue(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label
                                            htmlFor="publish-summary"
                                            className="text-xs font-medium"
                                        >
                                            Public Member Summary (Required)
                                        </label>
                                        <textarea
                                            id="publish-summary"
                                            rows={3}
                                            required
                                            maxLength={2000}
                                            placeholder="Concise public description displayed on the Member Portal calendar..."
                                            value={publishSummary}
                                            onChange={(e) => setPublishSummary(e.target.value)}
                                            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                                        />
                                    </div>
                                </>
                            ) : null}

                            {transitionPrompt.requiresNote ? (
                                <div className="flex flex-col gap-1.5">
                                    <label
                                        htmlFor="transition-note"
                                        className="text-xs font-medium"
                                    >
                                        Feedback / Reason (min 5 chars)
                                    </label>
                                    <textarea
                                        id="transition-note"
                                        rows={3}
                                        required
                                        maxLength={2000}
                                        value={transitionNote}
                                        onChange={(e) => setTransitionNote(e.target.value)}
                                        placeholder="Document the decision rationale..."
                                        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                                    />
                                </div>
                            ) : null}

                            {isSuperAdmin ? (
                                <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                                    <label
                                        htmlFor="transition-bg-reason"
                                        className="flex items-center gap-1.5 text-xs font-medium text-warning"
                                    >
                                        <ShieldAlert
                                            className="size-3.5"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        Super Admin Break-Glass Audit Reason (min 10 chars)
                                    </label>
                                    <Input
                                        id="transition-bg-reason"
                                        required
                                        value={transitionBgReason}
                                        onChange={(e) => setTransitionBgReason(e.target.value)}
                                        placeholder="Administrative justification for this override..."
                                    />
                                </div>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="submit"
                                    size="sm"
                                    variant={
                                        transitionPrompt.destructive ? "destructive" : "primary"
                                    }
                                    disabled={
                                        savingTransition ||
                                        (transitionPrompt.requiresNote &&
                                            transitionNote.trim().length < 5) ||
                                        (transitionPrompt.isPublish &&
                                            (!publishVenue.trim() || !publishSummary.trim())) ||
                                        (isSuperAdmin && transitionBgReason.trim().length < 10)
                                    }
                                >
                                    {savingTransition ? "Processing..." : "Confirm"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setTransitionPrompt(null)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            <div
                role="tablist"
                aria-label="Event Hub sections"
                className="flex gap-1 overflow-x-auto border-b border-border pb-px"
            >
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            onClick={() => selectTab(tab.id)}
                            className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition-colors sm:min-h-10 ${
                                isSelected
                                    ? "border-primary text-primary dark:text-brand-accent"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            <span>{tab.label}</span>
                            {tab.count !== undefined ? (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                    {tab.count}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            {activeTab === "overview" ? (
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="flex flex-col gap-6 lg:col-span-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Event Proposal &amp; Description</CardTitle>
                                <CardDescription>
                                    Authored by{" "}
                                    {event.createdBy
                                        ? `${event.createdBy.fullName} (${event.createdBy.studentIdNumber})`
                                        : "Unknown"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <SafeHtmlDisplay
                                    html={event.descriptionHtml}
                                    emptyLabel="No proposal description provided."
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <MessageSquare
                                        className="size-4 text-muted-foreground"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Review &amp; Feedback Timeline</span>
                                </CardTitle>
                                <CardDescription>
                                    Chronological officer comments and Executive lifecycle
                                    decisions.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                                {reviews.length === 0 ? (
                                    <p className="py-4 text-center text-sm text-muted-foreground">
                                        No review comments or decisions recorded yet.
                                    </p>
                                ) : (
                                    <ol className="flex flex-col gap-3">
                                        {reviews.map((rev) => (
                                            <li
                                                key={rev.id}
                                                className="rounded-lg border border-border bg-muted/30 p-3.5"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {decisionBadge(rev.decisionType)}
                                                        <span className="text-xs font-medium text-foreground">
                                                            {rev.reviewer?.fullName ?? "Reviewer"}
                                                        </span>
                                                        {rev.reviewer ? (
                                                            <span className="font-mono text-xs text-muted-foreground">
                                                                {rev.reviewer.studentIdNumber}
                                                            </span>
                                                        ) : null}
                                                        <span className="font-mono text-xs text-muted-foreground">
                                                            Rev #{rev.revisionNumber}
                                                        </span>
                                                    </div>
                                                    <span className="font-mono text-xs text-muted-foreground">
                                                        {formatManilaTimestamp(rev.createdAt)}
                                                    </span>
                                                </div>
                                                {rev.feedbackNote ? (
                                                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                                                        {rev.feedbackNote}
                                                    </p>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ol>
                                )}

                                {!isLocked || isSuperAdmin ? (
                                    <form
                                        onSubmit={handleCommentSubmit}
                                        className="flex flex-col gap-3 border-t border-border pt-4"
                                    >
                                        <label
                                            htmlFor="proposal-review-comment"
                                            className="text-xs font-medium"
                                        >
                                            Add Collaborative Review Note
                                        </label>
                                        <textarea
                                            id="proposal-review-comment"
                                            rows={3}
                                            required
                                            maxLength={2000}
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            placeholder="Share suggestions, resource notes, or schedule feedback..."
                                            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                                        />
                                        {isSuperAdmin ? (
                                            <Input
                                                aria-label="Super Admin Break-Glass reason for comment"
                                                required
                                                placeholder="Super Admin break-glass audit reason (min 10 chars)..."
                                                value={commentBgReason}
                                                onChange={(e) =>
                                                    setCommentBgReason(e.target.value)
                                                }
                                            />
                                        ) : null}
                                        <div>
                                            <Button
                                                type="submit"
                                                size="sm"
                                                disabled={
                                                    savingComment ||
                                                    commentText.trim().length < 2 ||
                                                    (isSuperAdmin &&
                                                        commentBgReason.trim().length < 10)
                                                }
                                            >
                                                {savingComment ? "Posting..." : "Post Comment"}
                                            </Button>
                                        </div>
                                    </form>
                                ) : null}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex flex-col gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Public Calendar Preview</CardTitle>
                                <CardDescription>
                                    Only these fields appear on the General Member Portal once
                                    PUBLISHED.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3 text-sm">
                                <div>
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Public Summary
                                    </span>
                                    <p className="mt-0.5 text-sm text-foreground">
                                        {event.publicSummary ||
                                            "No public summary written yet (required before Publish)."}
                                    </p>
                                </div>
                                <div className="grid gap-2 border-t border-border pt-3 text-xs">
                                    <div className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">Venue</span>
                                        <span className="font-medium text-foreground">
                                            {event.venue ?? "TBD"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">Audience</span>
                                        <span className="font-medium text-foreground">
                                            {event.targetAudience ?? "All SYComP Members"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">Slug</span>
                                        <span className="font-mono text-foreground">
                                            {event.slug}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Governance Milestones</CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-2.5 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Approved</span>
                                    <span className="font-mono text-foreground">
                                        {event.approvedAt
                                            ? formatManilaTimestamp(event.approvedAt)
                                            : "Pending"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Published</span>
                                    <span className="font-mono text-foreground">
                                        {event.publishedAt
                                            ? formatManilaTimestamp(event.publishedAt)
                                            : "Unpublished"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Completed</span>
                                    <span className="font-mono text-foreground">
                                        {event.completedAt
                                            ? formatManilaTimestamp(event.completedAt)
                                            : "Active"}
                                    </span>
                                </div>
                                <div className="border-t border-border pt-3">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => selectTab("documents")}
                                    >
                                        <FolderOpen
                                            className="size-3.5"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        <span>
                                            View Proposal &amp; Event Files ({event.documentCount})
                                        </span>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            ) : null}

            {activeTab === "committees" ? (
                <CommitteesTab
                    eventId={event.id}
                    eventTitle={event.title}
                    eventStatus={event.status}
                    termStatus={event.academicTerm.status}
                    actorId={actorId}
                    userRole={userRole}
                    committees={committees}
                    eligibleOfficers={eligibleOfficers}
                    onCommitteesChange={(next) => {
                        setCommittees(next);
                        setEvent((prev) => ({ ...prev, committeeCount: next.length }));
                    }}
                />
            ) : null}

            {activeTab === "tasks" ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <CheckSquare
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm font-medium text-foreground">
                            Event Tasks &amp; Deliverables Board (Upcoming Slice)
                        </p>
                        <p className="max-w-md text-xs text-muted-foreground">
                            {committeesUnlocked
                                ? `${event.completedTaskCount} of ${event.taskCount} tasks completed across ${committees.length} committees. Interactive task creation, assignment, and Kanban board will mount here in the Track B Tasks slice.`
                                : "Tasks will unlock alongside Committees once this event proposal is APPROVED."}
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {activeTab === "attendance" ? (
                <EventAttendanceTab
                    eventId={event.id}
                    eventStatus={event.status}
                    userRole={userRole}
                />
            ) : null}

            {activeTab === "documents" ? (
                <EventDocumentsTab
                    eventId={event.id}
                    eventStatus={event.status}
                    userRole={userRole}
                />
            ) : null}

            {editOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="edit-event-modal-title"
                >
                    <div
                        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                        style={{ boxShadow: "var(--shadow-overlay-md)" }}
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                            <div>
                                <h2 id="edit-event-modal-title" className="text-base font-semibold">
                                    {isAuthorEditableStatus
                                        ? "Edit Event Proposal"
                                        : "Edit Event Details"}
                                </h2>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    Changes are sanitized server-side and recorded in the audit
                                    ledger.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={savingEdit}
                                aria-label="Close edit dialog"
                                onClick={() => setEditOpen(false)}
                            >
                                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>

                        <form onSubmit={handleEditSave} className="mt-4 flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="edit-event-title" className="text-xs font-medium">
                                    Event Title
                                </label>
                                <Input
                                    id="edit-event-title"
                                    required
                                    maxLength={200}
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                />
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                    <label
                                        htmlFor="edit-event-start"
                                        className="text-xs font-medium"
                                    >
                                        Start (PHT)
                                    </label>
                                    <Input
                                        id="edit-event-start"
                                        type="datetime-local"
                                        required
                                        className="font-mono text-xs"
                                        value={editStart}
                                        onChange={(e) => setEditStart(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="edit-event-end" className="text-xs font-medium">
                                        End (PHT)
                                    </label>
                                    <Input
                                        id="edit-event-end"
                                        type="datetime-local"
                                        required
                                        className="font-mono text-xs"
                                        value={editEnd}
                                        onChange={(e) => setEditEnd(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                    <label
                                        htmlFor="edit-event-venue"
                                        className="text-xs font-medium"
                                    >
                                        Venue
                                    </label>
                                    <Input
                                        id="edit-event-venue"
                                        maxLength={255}
                                        placeholder="HNU Barder Hall"
                                        value={editVenue}
                                        onChange={(e) => setEditVenue(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label
                                        htmlFor="edit-event-audience"
                                        className="text-xs font-medium"
                                    >
                                        Target Audience
                                    </label>
                                    <Input
                                        id="edit-event-audience"
                                        maxLength={150}
                                        placeholder="All BSIT / BSCS Students"
                                        value={editAudience}
                                        onChange={(e) => setEditAudience(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="edit-event-summary"
                                    className="text-xs font-medium"
                                >
                                    Public Member Summary (Shown on Calendar once Published)
                                </label>
                                <textarea
                                    id="edit-event-summary"
                                    rows={2}
                                    maxLength={2000}
                                    value={editPublicSummary}
                                    onChange={(e) => setEditPublicSummary(e.target.value)}
                                    className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                                />
                            </div>

                            <RichTextEditor
                                id="edit-event-desc"
                                label="Proposal Description"
                                value={editDescription}
                                onChange={setEditDescription}
                                disabled={savingEdit}
                            />

                            {isSuperAdmin ? (
                                <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                                    <label
                                        htmlFor="edit-event-bg"
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
                                        id="edit-event-bg"
                                        required
                                        value={editBgReason}
                                        onChange={(e) => setEditBgReason(e.target.value)}
                                        placeholder="Document why Super Admin is editing this event..."
                                    />
                                </div>
                            ) : null}

                            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={savingEdit}
                                    onClick={() => setEditOpen(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={
                                        savingEdit ||
                                        (isSuperAdmin && editBgReason.trim().length < 10)
                                    }
                                >
                                    {savingEdit ? "Saving..." : "Save Changes"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}

            <BreakGlassModal
                open={Boolean(bgAction)}
                actionLabel={bgAction?.actionLabel ?? ""}
                targetLabel={event.title}
                submitting={savingTransition}
                onCancel={() => setBgAction(null)}
                onConfirm={(reason) => {
                    if (!bgAction) return;
                    return executeTransition(bgAction.action, { breakGlassReason: reason });
                }}
            />
        </div>
    );
}
