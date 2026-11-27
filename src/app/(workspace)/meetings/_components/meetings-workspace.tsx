"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    CalendarPlus,
    ChevronLeft,
    ChevronRight,
    Loader2,
    MapPin,
    RotateCcw,
    Search,
    UsersRound,
} from "lucide-react";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    MEETING_STATUSES,
    MEETINGS_DEFAULT_LIMIT,
    type MeetingListItemDto,
    type MeetingTermOption,
} from "@/app/api/meetings/_lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MeetingFormDialog } from "./meeting-form-dialog";
import { MeetingStatusBadge } from "./meeting-status-badge";

interface MeetingsWorkspaceProps {
    userRole: SystemRole;
    initialItems: MeetingListItemDto[];
    initialTotal: number;
    terms: MeetingTermOption[];
    activeTerm: MeetingTermOption | null;
}

export function MeetingsWorkspace({
    userRole,
    initialItems,
    initialTotal,
    terms,
    activeTerm,
}: MeetingsWorkspaceProps) {
    const router = useRouter();
    const canManage = userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN";

    const [items, setItems] = useState<MeetingListItemDto[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);

    const [q, setQ] = useState("");
    const [status, setStatus] = useState("");
    const [academicTermId, setAcademicTermId] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

    const totalPages = Math.max(1, Math.ceil(total / MEETINGS_DEFAULT_LIMIT));
    const hasActiveFilters = Boolean(q.trim() || status || academicTermId || fromDate || toDate);

    function buildParams(targetPage: number) {
        const params = new URLSearchParams({
            page: String(targetPage),
            limit: String(MEETINGS_DEFAULT_LIMIT),
        });
        if (q.trim()) params.set("q", q.trim());
        if (status) params.set("status", status);
        if (academicTermId) params.set("academicTermId", academicTermId);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        return params;
    }

    async function fetchMeetings(targetPage: number, reset = false) {
        setLoading(true);
        setErrorMsg(null);
        try {
            const params = reset
                ? new URLSearchParams({
                      page: "1",
                      limit: String(MEETINGS_DEFAULT_LIMIT),
                  })
                : buildParams(targetPage);

            const res = await fetch(`${ROUTES.api.meetings}?${params.toString()}`);
            const payload = (await res.json()) as {
                data?: {
                    items: MeetingListItemDto[];
                    pagination: { page: number; total: number };
                };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to load officer meetings.");
                return;
            }
            setItems(payload.data.items);
            setTotal(payload.data.pagination.total);
            setPage(payload.data.pagination.page);
        } finally {
            setLoading(false);
        }
    }

    function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (fromDate && toDate && toDate < fromDate) {
            setErrorMsg("'To' date must be on or after 'From' date.");
            return;
        }
        void fetchMeetings(1);
    }

    function handleReset() {
        setQ("");
        setStatus("");
        setAcademicTermId("");
        setFromDate("");
        setToDate("");
        void fetchMeetings(1, true);
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                    Showing <span className="font-mono text-foreground">{total}</span>{" "}
                    {total === 1 ? "meeting" : "meetings"}
                    {activeTerm ? (
                        <>
                            {" "}
                            &bull; Active Term:{" "}
                            <span className="font-mono text-foreground">{activeTerm.code}</span>
                        </>
                    ) : null}
                </div>
                {canManage ? (
                    <Button
                        type="button"
                        disabled={!activeTerm}
                        onClick={() => setCreateOpen(true)}
                    >
                        <CalendarPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        <span>Schedule Meeting</span>
                    </Button>
                ) : null}
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
                    className="grid gap-3 border-b border-border bg-muted/40 p-4 md:grid-cols-6"
                >
                    <div className="relative md:col-span-2">
                        <Search
                            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        <Input
                            aria-label="Search meetings"
                            placeholder="Search meeting title or venue..."
                            className="pl-9"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <select
                        aria-label="Filter by meeting status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Statuses</option>
                        {MEETING_STATUSES.map((st) => (
                            <option key={st} value={st}>
                                {st}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by academic term"
                        value={academicTermId}
                        onChange={(e) => setAcademicTermId(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Terms</option>
                        {terms.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.code}
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
                    <Input
                        aria-label="To date (PHT)"
                        type="date"
                        className="font-mono text-xs"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                    />
                    <div className="flex flex-wrap justify-end gap-2 md:col-span-6">
                        {hasActiveFilters ? (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={loading}
                                onClick={handleReset}
                            >
                                <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                <span>Reset</span>
                            </Button>
                        ) : null}
                        <Button type="submit" variant="secondary" disabled={loading}>
                            {loading ? (
                                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                                <Search className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            )}
                            <span>Apply Filters</span>
                        </Button>
                    </div>
                </form>

                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                        <UsersRound
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            {hasActiveFilters
                                ? "No officer meetings match the current filters."
                                : "No officer meetings have been scheduled yet."}
                        </p>
                        {!hasActiveFilters && canManage && activeTerm ? (
                            <Button
                                type="button"
                                size="sm"
                                className="mt-1"
                                onClick={() => setCreateOpen(true)}
                            >
                                <CalendarPlus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Schedule Meeting</span>
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                                    <th className="px-4 py-3">Meeting</th>
                                    <th className="px-4 py-3">Schedule (PHT)</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Checkpoints &amp; Minutes</th>
                                    <th className="px-4 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {items.map((meeting) => (
                                    <tr key={meeting.id} className="hover:bg-muted/30">
                                        <td className="px-4 py-3">
                                            <Link
                                                href={ROUTES.workspace.meetingDetail(meeting.id)}
                                                className="font-medium text-foreground hover:text-primary"
                                            >
                                                {meeting.title}
                                            </Link>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                <span className="font-mono">
                                                    {meeting.academicTerm.code}
                                                </span>
                                                {meeting.locationOrLink ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <MapPin
                                                            className="size-3"
                                                            strokeWidth={1.75}
                                                            aria-hidden="true"
                                                        />
                                                        {meeting.locationOrLink}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                                            {formatManilaTimestamp(meeting.scheduledStartAt)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <MeetingStatusBadge status={meeting.status} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                <span className="font-mono">
                                                    {meeting.checkpointCount} checkpoints
                                                    {meeting.openCheckpointCount > 0
                                                        ? ` (${meeting.openCheckpointCount} OPEN)`
                                                        : ""}
                                                </span>
                                                <span>&bull;</span>
                                                <span>
                                                    {meeting.hasMinutes ? "Minutes saved" : "No minutes"}
                                                </span>
                                                <span>&bull;</span>
                                                <span className="font-mono">
                                                    {meeting.documentCount} files
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link
                                                href={ROUTES.workspace.meetingDetail(meeting.id)}
                                                className="inline-flex min-h-11 items-center rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 sm:min-h-9"
                                            >
                                                Open Workspace
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {total > MEETINGS_DEFAULT_LIMIT ? (
                    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                        <span>
                            Page <span className="font-mono text-foreground">{page}</span> of{" "}
                            <span className="font-mono text-foreground">{totalPages}</span>
                        </span>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={loading || page <= 1}
                                onClick={() => void fetchMeetings(page - 1)}
                            >
                                <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Previous</span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={loading || page >= totalPages}
                                onClick={() => void fetchMeetings(page + 1)}
                            >
                                <span>Next</span>
                                <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <MeetingFormDialog
                open={createOpen}
                userRole={userRole}
                onClose={() => setCreateOpen(false)}
                onSuccess={(created) => {
                    setCreateOpen(false);
                    router.push(ROUTES.workspace.meetingDetail(created.id));
                    router.refresh();
                }}
            />
        </div>
    );
}
