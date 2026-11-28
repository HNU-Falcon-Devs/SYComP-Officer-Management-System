"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
    AlertCircle,
    Calendar,
    ChevronLeft,
    ChevronRight,
    List,
    Loader2,
    MapPin,
    Plus,
    Radio,
    Search,
    Users,
} from "lucide-react";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    EVENT_STATUSES,
    EVENTS_DEFAULT_LIMIT,
    type EventListItemDto,
    type EventStatus,
} from "@/app/api/events/_lib/validation";
import { EventStatusBadge } from "@/components/event-hub/event-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface TermOption {
    id: string;
    code: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
}

interface EventsWorkspaceProps {
    initialItems: EventListItemDto[];
    initialTotal: number;
    terms: TermOption[];
    activeTerm: TermOption | null;
}

type FilterView = "all" | "proposals" | "active" | "archived";

function getManilaYearMonth(date: Date): { year: number; month: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { year: Number(map.year), month: Number(map.month) - 1 };
}

function getManilaDayKey(iso: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(iso));
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

export function EventsWorkspace({
    initialItems,
    initialTotal,
    terms,
    activeTerm,
}: EventsWorkspaceProps) {
    const [items, setItems] = useState<EventListItemDto[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);

    const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
    const [filterView, setFilterView] = useState<FilterView>("all");
    const [termFilter, setTermFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<EventStatus | "">("");
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const initialYm = getManilaYearMonth(new Date());
    const [calYear, setCalYear] = useState(initialYm.year);
    const [calMonth, setCalMonth] = useState(initialYm.month);

    const fetchEvents = useCallback(
        async (opts: {
            targetPage?: number;
            nextView?: FilterView;
            nextTerm?: string;
            nextStatus?: EventStatus | "";
            nextQ?: string;
        }) => {
            const targetPage = opts.targetPage ?? 1;
            const nextView = opts.nextView ?? filterView;
            const nextTerm = opts.nextTerm ?? termFilter;
            const nextStatus = opts.nextStatus ?? statusFilter;
            const nextQ = opts.nextQ ?? q;

            setLoading(true);
            setErrorMsg(null);
            try {
                const params = new URLSearchParams({
                    page: String(targetPage),
                    limit: String(EVENTS_DEFAULT_LIMIT),
                });
                if (nextView !== "all") params.set("view", nextView);
                if (nextTerm) params.set("termId", nextTerm);
                if (nextStatus) params.set("status", nextStatus);
                if (nextQ.trim()) params.set("q", nextQ.trim());

                const res = await fetch(`${ROUTES.api.events}?${params.toString()}`);
                const payload = (await res.json()) as {
                    data?: {
                        items: EventListItemDto[];
                        pagination: { page: number; total: number };
                    };
                    error?: { message?: string };
                };
                if (!res.ok || !payload.data) {
                    setErrorMsg(payload.error?.message ?? "Failed to load events.");
                    return;
                }
                setItems(payload.data.items);
                setTotal(payload.data.pagination.total);
                setPage(payload.data.pagination.page);
            } catch {
                setErrorMsg("Network error while loading events.");
            } finally {
                setLoading(false);
            }
        },
        [filterView, q, statusFilter, termFilter],
    );

    function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        void fetchEvents({ targetPage: 1 });
    }

    const totalPages = Math.max(1, Math.ceil(total / EVENTS_DEFAULT_LIMIT));

    const calendarCells = useMemo(() => {
        const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
        const startWeekday = firstDay.getUTCDay();
        const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
        const byDay = new Map<string, EventListItemDto[]>();
        for (const item of items) {
            const key = getManilaDayKey(item.startAt);
            const list = byDay.get(key) ?? [];
            list.push(item);
            byDay.set(key, list);
        }

        const cells: Array<{ day: number | null; key: string; events: EventListItemDto[] }> = [];
        for (let i = 0; i < startWeekday; i += 1) {
            cells.push({ day: null, key: `empty-${i}`, events: [] });
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
            const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            cells.push({ day, key, events: byDay.get(key) ?? [] });
        }
        return cells;
    }, [calMonth, calYear, items]);

    const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(Date.UTC(calYear, calMonth, 1)));

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                    {(
                        [
                            { id: "all", label: "All Events" },
                            { id: "proposals", label: "Proposal Workspace" },
                            { id: "active", label: "Approved & Published" },
                            { id: "archived", label: "Completed & Rejected" },
                        ] as const
                    ).map((seg) => (
                        <button
                            key={seg.id}
                            type="button"
                            onClick={() => {
                                setFilterView(seg.id);
                                setStatusFilter("");
                                void fetchEvents({
                                    targetPage: 1,
                                    nextView: seg.id,
                                    nextStatus: "",
                                });
                            }}
                            className={`min-h-11 rounded-full border px-3.5 text-xs font-medium transition-colors sm:min-h-9 ${
                                filterView === seg.id
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
                            onClick={() => setViewMode("calendar")}
                            className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 font-medium sm:min-h-8 ${
                                viewMode === "calendar"
                                    ? "bg-card text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Calendar className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span>Calendar</span>
                        </button>
                    </div>

                    {activeTerm ? (
                        <Link
                            href={ROUTES.workspace.eventNew}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-9"
                        >
                            <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            <span>New Proposal</span>
                        </Link>
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
                    onSubmit={handleSearchSubmit}
                    className="grid gap-3 border-b border-border bg-muted/40 p-4 md:grid-cols-5"
                >
                    <div className="relative md:col-span-2">
                        <Search
                            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        <Input
                            aria-label="Search events by title, venue, or audience"
                            placeholder="Search title, venue, or audience..."
                            className="pl-9"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <select
                        aria-label="Filter by academic term"
                        value={termFilter}
                        onChange={(e) => {
                            setTermFilter(e.target.value);
                            void fetchEvents({ targetPage: 1, nextTerm: e.target.value });
                        }}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Academic Terms</option>
                        {terms.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.code} ({t.status})
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by event status"
                        value={statusFilter}
                        onChange={(e) => {
                            const val = e.target.value as EventStatus | "";
                            setStatusFilter(val);
                            void fetchEvents({ targetPage: 1, nextStatus: val });
                        }}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Statuses</option>
                        {EVENT_STATUSES.map((st) => (
                            <option key={st} value={st}>
                                {st.replace("_", " ")}
                            </option>
                        ))}
                    </select>
                    <Button type="submit" disabled={loading}>
                        {loading ? (
                            <Loader2
                                className="size-4 animate-spin"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                        ) : (
                            "Filter"
                        )}
                    </Button>
                </form>

                {viewMode === "list" ? (
                    items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                            <Calendar
                                className="size-10 text-muted-foreground"
                                strokeWidth={1.5}
                                aria-hidden="true"
                            />
                            <p className="text-sm text-muted-foreground">
                                No events or proposals match the active filters.
                            </p>
                            {activeTerm ? (
                                <Link
                                    href={ROUTES.workspace.eventNew}
                                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-9"
                                >
                                    <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    <span>Draft First Proposal</span>
                                </Link>
                            ) : null}
                        </div>
                    ) : (
                        <>
                            <ul className="divide-y divide-border">
                                {items.map((item) => (
                                    <li key={item.id} className="p-4 transition-colors hover:bg-muted/30">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Link
                                                        href={ROUTES.workspace.eventDetail(item.slug)}
                                                        className="text-base font-semibold text-foreground hover:text-primary hover:underline dark:hover:text-brand-accent"
                                                    >
                                                        {item.title}
                                                    </Link>
                                                    <EventStatusBadge status={item.status} />
                                                    <Badge variant="neutral" className="font-mono">
                                                        {item.academicTerm.code}
                                                    </Badge>
                                                    {item.openCheckpointCount > 0 ? (
                                                        <Badge variant="success">
                                                            <Radio
                                                                className="size-3"
                                                                strokeWidth={1.75}
                                                                aria-hidden="true"
                                                            />
                                                            {item.openCheckpointCount} Live Scan
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                    <span className="font-mono">
                                                        {formatManilaTimestamp(item.startAt)}
                                                    </span>
                                                    {item.venue ? (
                                                        <span className="inline-flex items-center gap-1 text-foreground">
                                                            <MapPin
                                                                className="size-3.5"
                                                                strokeWidth={1.75}
                                                                aria-hidden="true"
                                                            />
                                                            {item.venue}
                                                        </span>
                                                    ) : null}
                                                    <span className="inline-flex items-center gap-1">
                                                        <Users
                                                            className="size-3.5"
                                                            strokeWidth={1.75}
                                                            aria-hidden="true"
                                                        />
                                                        {item.committeeCount} committees
                                                    </span>
                                                    {item.createdBy ? (
                                                        <span>Author: {item.createdBy.fullName}</span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <Link
                                                href={ROUTES.workspace.eventDetail(item.slug)}
                                                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 sm:min-h-9"
                                            >
                                                Open Hub
                                            </Link>
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
                                <span className="font-mono text-muted-foreground">
                                    Showing {items.length} of {total} &bull; Page {page} of{" "}
                                    {totalPages}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        disabled={page <= 1 || loading}
                                        onClick={() => void fetchEvents({ targetPage: page - 1 })}
                                    >
                                        <ChevronLeft
                                            className="size-3.5"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        <span>Previous</span>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        disabled={page >= totalPages || loading}
                                        onClick={() => void fetchEvents({ targetPage: page + 1 })}
                                    >
                                        <span>Next</span>
                                        <ChevronRight
                                            className="size-3.5"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )
                ) : (
                    <Card className="rounded-none border-0">
                        <CardContent className="p-4">
                            <div className="mb-4 flex items-center justify-between gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        if (calMonth === 0) {
                                            setCalMonth(11);
                                            setCalYear((y) => y - 1);
                                        } else {
                                            setCalMonth((m) => m - 1);
                                        }
                                    }}
                                >
                                    <ChevronLeft
                                        className="size-4"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span>Prev</span>
                                </Button>
                                <h2 className="text-sm font-semibold">{monthLabel}</h2>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        if (calMonth === 11) {
                                            setCalMonth(0);
                                            setCalYear((y) => y + 1);
                                        } else {
                                            setCalMonth((m) => m + 1);
                                        }
                                    }}
                                >
                                    <span>Next</span>
                                    <ChevronRight
                                        className="size-4"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                </Button>
                            </div>

                            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                                    <div
                                        key={d}
                                        className="bg-muted px-2 py-2 text-center font-medium text-muted-foreground"
                                    >
                                        {d}
                                    </div>
                                ))}
                                {calendarCells.map((cell) => (
                                    <div
                                        key={cell.key}
                                        className="min-h-24 bg-card p-1.5 align-top"
                                    >
                                        {cell.day !== null ? (
                                            <>
                                                <div className="font-mono text-xs text-muted-foreground">
                                                    {cell.day}
                                                </div>
                                                <div className="mt-1 flex flex-col gap-1">
                                                    {cell.events.map((ev) => (
                                                        <Link
                                                            key={ev.id}
                                                            href={ROUTES.workspace.eventDetail(
                                                                ev.slug,
                                                            )}
                                                            className="block truncate rounded bg-brand-soft px-1.5 py-0.5 text-xs font-medium text-primary hover:underline dark:text-brand-accent"
                                                            title={`${ev.title} (${ev.status})`}
                                                        >
                                                            {ev.title}
                                                        </Link>
                                                    ))}
                                                </div>
                                            </>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
