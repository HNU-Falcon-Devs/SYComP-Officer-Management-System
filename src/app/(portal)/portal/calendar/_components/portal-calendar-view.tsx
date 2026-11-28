"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Archive,
    Calendar,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    Globe,
    List,
    MapPin,
    Users,
    X,
} from "lucide-react";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import type { PublicPortalEventDto } from "@/app/api/events/_lib/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

export function PortalCalendarView({ events }: { events: PublicPortalEventDto[] }) {
    const [viewMode, setViewMode] = useState<"list" | "month">("list");
    const [selected, setSelected] = useState<PublicPortalEventDto | null>(null);

    const initialYm = getManilaYearMonth(new Date());
    const [calYear, setCalYear] = useState(initialYm.year);
    const [calMonth, setCalMonth] = useState(initialYm.month);

    useEffect(() => {
        if (!selected) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelected(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selected]);

    const cells = useMemo(() => {
        const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
        const startWeekday = firstDay.getUTCDay();
        const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
        const byDay = new Map<string, PublicPortalEventDto[]>();
        for (const item of events) {
            const key = getManilaDayKey(item.startAt);
            const list = byDay.get(key) ?? [];
            list.push(item);
            byDay.set(key, list);
        }

        const grid: Array<{ day: number | null; key: string; items: PublicPortalEventDto[] }> = [];
        for (let i = 0; i < startWeekday; i += 1) {
            grid.push({ day: null, key: `empty-${i}`, items: [] });
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
            const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            grid.push({ day, key, items: byDay.get(key) ?? [] });
        }
        return grid;
    }, [calMonth, calYear, events]);

    const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(Date.UTC(calYear, calMonth, 1)));

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Event Calendar</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Published and completed SYComP events visible to general members.
                    </p>
                </div>
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
                        onClick={() => setViewMode("month")}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 font-medium sm:min-h-8 ${
                            viewMode === "month"
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Calendar className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Month</span>
                    </button>
                </div>
            </div>

            {events.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Calendar
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            No published events are on the calendar yet.
                        </p>
                    </CardContent>
                </Card>
            ) : viewMode === "list" ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <ul className="divide-y divide-border">
                        {events.map((ev) => (
                            <li
                                key={ev.id}
                                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between"
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-base font-semibold">{ev.title}</span>
                                        {ev.status === "PUBLISHED" ? (
                                            <Badge variant="success">
                                                <Globe
                                                    className="size-3"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                PUBLISHED
                                            </Badge>
                                        ) : (
                                            <Badge variant="neutral">
                                                <Archive
                                                    className="size-3"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                COMPLETED
                                            </Badge>
                                        )}
                                        <Badge variant="neutral" className="font-mono">
                                            {ev.academicTerm.code}
                                        </Badge>
                                    </div>
                                    {ev.publicSummary ? (
                                        <p className="max-w-2xl text-sm text-muted-foreground">
                                            {ev.publicSummary}
                                        </p>
                                    ) : null}
                                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                        <span className="font-mono">
                                            {formatManilaTimestamp(ev.startAt)}
                                        </span>
                                        {ev.venue ? (
                                            <span className="inline-flex items-center gap-1 text-foreground">
                                                <MapPin
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                                {ev.venue}
                                            </span>
                                        ) : null}
                                        {ev.targetAudience ? <span>{ev.targetAudience}</span> : null}
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setSelected(ev)}
                                >
                                    Details
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <Card>
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
                                <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
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
                                <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
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
                            {cells.map((cell) => (
                                <div key={cell.key} className="min-h-24 bg-card p-1.5 align-top">
                                    {cell.day !== null ? (
                                        <>
                                            <div className="font-mono text-xs text-muted-foreground">
                                                {cell.day}
                                            </div>
                                            <div className="mt-1 flex flex-col gap-1">
                                                {cell.items.map((ev) => (
                                                    <button
                                                        key={ev.id}
                                                        type="button"
                                                        onClick={() => setSelected(ev)}
                                                        className="w-full truncate rounded bg-brand-soft px-1.5 py-1 text-left text-xs font-medium text-primary hover:opacity-80 dark:text-brand-accent"
                                                    >
                                                        {ev.title}
                                                    </button>
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

            {selected ? (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="portal-event-detail-title"
                >
                    <div
                        className="w-full max-w-lg rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                        style={{ boxShadow: "var(--shadow-overlay-md)" }}
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {selected.status === "PUBLISHED" ? (
                                        <Badge variant="success">
                                            <Globe
                                                className="size-3"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            PUBLISHED
                                        </Badge>
                                    ) : (
                                        <Badge variant="neutral">
                                            <Archive
                                                className="size-3"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            COMPLETED
                                        </Badge>
                                    )}
                                    <Badge variant="neutral" className="font-mono">
                                        {selected.academicTerm.code}
                                    </Badge>
                                </div>
                                <h2
                                    id="portal-event-detail-title"
                                    className="mt-2 text-lg font-semibold"
                                >
                                    {selected.title}
                                </h2>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Close event details"
                                onClick={() => setSelected(null)}
                            >
                                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 text-sm">
                            {selected.publicSummary ? (
                                <p className="leading-relaxed text-foreground">
                                    {selected.publicSummary}
                                </p>
                            ) : (
                                <p className="text-muted-foreground">
                                    No additional public summary provided.
                                </p>
                            )}

                            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                                <div className="flex items-center gap-2">
                                    <CalendarClock
                                        className="size-3.5 text-muted-foreground"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    <span className="font-mono text-foreground">
                                        {formatManilaTimestamp(selected.startAt)} &ndash;{" "}
                                        {formatManilaTimestamp(selected.endAt)}
                                    </span>
                                </div>
                                {selected.venue ? (
                                    <div className="flex items-center gap-2">
                                        <MapPin
                                            className="size-3.5 text-muted-foreground"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        <span className="text-foreground">{selected.venue}</span>
                                    </div>
                                ) : null}
                                {selected.targetAudience ? (
                                    <div className="flex items-center gap-2">
                                        <Users
                                            className="size-3.5 text-muted-foreground"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        <span className="text-foreground">
                                            {selected.targetAudience}
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
