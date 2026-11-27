"use client";

import { Fragment, useState, type FormEvent } from "react";
import {
    AlertCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Download,
    Loader2,
    MinusCircle,
    Pencil,
    PlusCircle,
    RotateCcw,
    ScrollText,
    Search,
    ShieldAlert,
} from "lucide-react";
import { ROUTES } from "@/config/routes";
import {
    AUDIT_LOG_DEFAULT_LIMIT,
    computeStateDiff,
    formatManilaTimestamp,
    type AuditLogDto,
} from "@/lib/admin/audit-logs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface AuditLogsLedgerProps {
    initialItems: AuditLogDto[];
    initialTotal: number;
    actionOptions: string[];
    entityTypeOptions: string[];
}

function formatJsonValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
}

export function AuditLogsLedger({
    initialItems,
    initialTotal,
    actionOptions,
    entityTypeOptions,
}: AuditLogsLedgerProps) {
    const [items, setItems] = useState<AuditLogDto[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);

    const [q, setQ] = useState("");
    const [action, setAction] = useState("");
    const [entityType, setEntityType] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [breakGlassOnly, setBreakGlassOnly] = useState(false);

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / AUDIT_LOG_DEFAULT_LIMIT));
    const hasActiveFilters = Boolean(
        q.trim() || action || entityType || fromDate || toDate || breakGlassOnly,
    );

    function buildFilterParams(targetPage?: number) {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (action) params.set("action", action);
        if (entityType) params.set("entityType", entityType);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        if (breakGlassOnly) params.set("breakGlassOnly", "true");
        if (targetPage !== undefined) {
            params.set("page", String(targetPage));
            params.set("limit", String(AUDIT_LOG_DEFAULT_LIMIT));
        }
        return params;
    }

    async function fetchLogs(targetPage: number, overrides?: { reset?: boolean }) {
        setLoading(true);
        setErrorMsg(null);
        try {
            const params = overrides?.reset
                ? new URLSearchParams({
                      page: "1",
                      limit: String(AUDIT_LOG_DEFAULT_LIMIT),
                  })
                : buildFilterParams(targetPage);

            const res = await fetch(`${ROUTES.api.adminAuditLogs}?${params.toString()}`);
            const payload = (await res.json()) as {
                data?: {
                    items: AuditLogDto[];
                    pagination: { page: number; limit: number; total: number };
                };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to query audit logs.");
                return;
            }
            setItems(payload.data.items);
            setTotal(payload.data.pagination.total);
            setPage(payload.data.pagination.page);
            setExpandedId(null);
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
        void fetchLogs(1);
    }

    function handleResetFilters() {
        setQ("");
        setAction("");
        setEntityType("");
        setFromDate("");
        setToDate("");
        setBreakGlassOnly(false);
        void fetchLogs(1, { reset: true });
    }

    const exportQuery = buildFilterParams().toString();
    const exportHref = exportQuery
        ? `${ROUTES.api.adminAuditLogs}/export?${exportQuery}`
        : `${ROUTES.api.adminAuditLogs}/export`;

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
                <CardContent className="p-4">
                    <form onSubmit={handleFilterSubmit} className="grid gap-3 md:grid-cols-6">
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                            <label htmlFor="audit-search" className="text-xs font-medium">
                                Search
                            </label>
                            <div className="relative">
                                <Search
                                    className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                                <Input
                                    id="audit-search"
                                    placeholder="Actor ID, name, action, entity ID, or reason..."
                                    className="pl-9"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="audit-action" className="text-xs font-medium">
                                Action
                            </label>
                            <select
                                id="audit-action"
                                value={action}
                                onChange={(e) => setAction(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 font-mono text-xs sm:min-h-10"
                            >
                                <option value="">All Actions</option>
                                {actionOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                        {opt}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="audit-entity" className="text-xs font-medium">
                                Entity Type
                            </label>
                            <select
                                id="audit-entity"
                                value={entityType}
                                onChange={(e) => setEntityType(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 font-mono text-xs sm:min-h-10"
                            >
                                <option value="">All Entities</option>
                                {entityTypeOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                        {opt}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="audit-from" className="text-xs font-medium">
                                From (PHT)
                            </label>
                            <Input
                                id="audit-from"
                                type="date"
                                className="font-mono text-xs"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="audit-to" className="text-xs font-medium">
                                To (PHT)
                            </label>
                            <Input
                                id="audit-to"
                                type="date"
                                className="font-mono text-xs"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 md:col-span-6">
                            <label
                                htmlFor="audit-break-glass"
                                className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-10"
                            >
                                <input
                                    id="audit-break-glass"
                                    type="checkbox"
                                    checked={breakGlassOnly}
                                    onChange={(e) => setBreakGlassOnly(e.target.checked)}
                                    className="size-4 rounded border-border accent-primary"
                                />
                                <ShieldAlert
                                    className="size-4 text-warning"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                                <span>Break-Glass overrides only</span>
                            </label>

                            <div className="flex items-center gap-2">
                                {hasActiveFilters ? (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={loading}
                                        onClick={handleResetFilters}
                                    >
                                        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                        <span>Reset</span>
                                    </Button>
                                ) : null}
                                <Button type="submit" disabled={loading}>
                                    {loading ? (
                                        <Loader2
                                            className="size-4 animate-spin"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                    ) : (
                                        <Search className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                    )}
                                    <span>Filter</span>
                                </Button>
                            </div>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
                    <span>
                        Showing <span className="font-mono text-foreground">{items.length}</span> of{" "}
                        <span className="font-mono text-foreground">{total}</span> audit entries
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
                                <th className="px-4 py-3">Timestamp (PHT)</th>
                                <th className="px-4 py-3">Action</th>
                                <th className="px-4 py-3">Entity</th>
                                <th className="px-4 py-3">Actor</th>
                                <th className="px-4 py-3">Reason</th>
                                <th className="px-4 py-3 text-right">Inspect</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-12 text-center">
                                        <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                                            <ScrollText
                                                className="size-10 text-muted-foreground"
                                                strokeWidth={1.5}
                                                aria-hidden="true"
                                            />
                                            <p className="text-sm text-muted-foreground">
                                                No audit entries match the current filters.
                                            </p>
                                            {hasActiveFilters ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={handleResetFilters}
                                                >
                                                    Reset Filters
                                                </Button>
                                            ) : null}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map((entry) => {
                                    const isOpen = expandedId === entry.id;
                                    const diffs = isOpen
                                        ? computeStateDiff(entry.beforeState, entry.afterState)
                                        : [];

                                    return (
                                        <Fragment key={entry.id}>
                                            <tr className={isOpen ? "bg-brand-soft/30" : undefined}>
                                                <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                                                    {formatManilaTimestamp(entry.createdAt)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-xs font-medium">
                                                            {entry.action}
                                                        </span>
                                                        {entry.isBreakGlass ? (
                                                            <Badge variant="warning">
                                                                <ShieldAlert
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                BREAK-GLASS
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="font-mono text-xs font-medium">
                                                        {entry.entityType}
                                                    </p>
                                                    <p
                                                        className="font-mono text-xs text-muted-foreground"
                                                        title={entry.entityId}
                                                    >
                                                        {entry.entityId.slice(0, 8)}
                                                    </p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {entry.actor ? (
                                                        <div>
                                                            <p className="text-sm font-medium">
                                                                {entry.actor.fullName}
                                                            </p>
                                                            <p className="font-mono text-xs text-muted-foreground">
                                                                {entry.actor.studentIdNumber}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <span className="font-mono text-xs text-muted-foreground">
                                                            System
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="max-w-xs px-4 py-3 text-xs text-muted-foreground">
                                                    <span className="line-clamp-2">
                                                        {entry.reason ?? "—"}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="sm"
                                                        aria-expanded={isOpen}
                                                        onClick={() =>
                                                            setExpandedId(isOpen ? null : entry.id)
                                                        }
                                                    >
                                                        {isOpen ? (
                                                            <ChevronUp
                                                                className="size-3.5"
                                                                strokeWidth={1.75}
                                                                aria-hidden="true"
                                                            />
                                                        ) : (
                                                            <ChevronDown
                                                                className="size-3.5"
                                                                strokeWidth={1.75}
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                        <span>{isOpen ? "Hide" : "Inspect"}</span>
                                                    </Button>
                                                </td>
                                            </tr>

                                            {isOpen ? (
                                                <tr className="bg-muted/35">
                                                    <td colSpan={6} className="px-4 py-4">
                                                        <div className="flex flex-col gap-4">
                                                            <div className="grid gap-3 rounded-lg border border-border bg-card p-3.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                                                                <div>
                                                                    <p className="font-medium text-muted-foreground">
                                                                        Audit ID
                                                                    </p>
                                                                    <p className="mt-0.5 break-all font-mono">
                                                                        {entry.id}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-muted-foreground">
                                                                        Entity ID
                                                                    </p>
                                                                    <p className="mt-0.5 break-all font-mono">
                                                                        {entry.entityId}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-muted-foreground">
                                                                        Timestamp (UTC ISO)
                                                                    </p>
                                                                    <p className="mt-0.5 font-mono">
                                                                        {entry.createdAt}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-muted-foreground">
                                                                        Source IP
                                                                    </p>
                                                                    <p className="mt-0.5 font-mono">
                                                                        {entry.ipAddress ?? "—"}
                                                                    </p>
                                                                </div>
                                                                {entry.reason ? (
                                                                    <div className="sm:col-span-2 lg:col-span-4">
                                                                        <p className="font-medium text-muted-foreground">
                                                                            Audit Reason
                                                                        </p>
                                                                        <p className="mt-0.5 text-sm text-foreground">
                                                                            {entry.reason}
                                                                        </p>
                                                                    </div>
                                                                ) : null}
                                                            </div>

                                                            {diffs.length > 0 ? (
                                                                <div className="overflow-hidden rounded-lg border border-border bg-card">
                                                                    <div className="border-b border-border bg-muted px-3.5 py-2 text-xs font-medium text-muted-foreground">
                                                                        Field-Level Snapshot Diff
                                                                    </div>
                                                                    <div className="divide-y divide-border">
                                                                        {diffs.map((d) => (
                                                                            <div
                                                                                key={d.key}
                                                                                className="grid gap-2 px-3.5 py-2 text-xs sm:grid-cols-4"
                                                                            >
                                                                                <div className="flex items-center gap-2 font-mono font-medium">
                                                                                    {d.kind === "added" ? (
                                                                                        <Badge variant="success">
                                                                                            <PlusCircle
                                                                                                className="size-3"
                                                                                                strokeWidth={1.75}
                                                                                                aria-hidden="true"
                                                                                            />
                                                                                            Added
                                                                                        </Badge>
                                                                                    ) : d.kind === "removed" ? (
                                                                                        <Badge variant="destructive">
                                                                                            <MinusCircle
                                                                                                className="size-3"
                                                                                                strokeWidth={1.75}
                                                                                                aria-hidden="true"
                                                                                            />
                                                                                            Removed
                                                                                        </Badge>
                                                                                    ) : d.kind === "changed" ? (
                                                                                        <Badge variant="warning">
                                                                                            <Pencil
                                                                                                className="size-3"
                                                                                                strokeWidth={1.75}
                                                                                                aria-hidden="true"
                                                                                            />
                                                                                            Changed
                                                                                        </Badge>
                                                                                    ) : (
                                                                                        <Badge variant="neutral">
                                                                                            Unchanged
                                                                                        </Badge>
                                                                                    )}
                                                                                    <span className="truncate">
                                                                                        {d.key}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="break-all font-mono text-muted-foreground sm:col-span-3">
                                                                                    {d.kind === "added"
                                                                                        ? formatJsonValue(d.after)
                                                                                        : d.kind === "removed"
                                                                                          ? formatJsonValue(d.before)
                                                                                          : d.kind === "changed"
                                                                                            ? `${formatJsonValue(d.before)} -> ${formatJsonValue(d.after)}`
                                                                                            : formatJsonValue(d.after)}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ) : null}

                                                            <div className="grid gap-3 md:grid-cols-2">
                                                                <div className="flex flex-col gap-1.5">
                                                                    <span className="text-xs font-medium text-muted-foreground">
                                                                        Before State (Redacted)
                                                                    </span>
                                                                    <pre className="max-h-60 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
                                                                        {entry.beforeState
                                                                            ? JSON.stringify(
                                                                                  entry.beforeState,
                                                                                  null,
                                                                                  2,
                                                                              )
                                                                            : "null"}
                                                                    </pre>
                                                                </div>
                                                                <div className="flex flex-col gap-1.5">
                                                                    <span className="text-xs font-medium text-muted-foreground">
                                                                        After State (Redacted)
                                                                    </span>
                                                                    <pre className="max-h-60 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
                                                                        {entry.afterState
                                                                            ? JSON.stringify(
                                                                                  entry.afterState,
                                                                                  null,
                                                                                  2,
                                                                              )
                                                                            : "null"}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </Fragment>
                                    );
                                })
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
                                disabled={loading || page <= 1}
                                onClick={() => void fetchLogs(page - 1)}
                            >
                                <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Previous</span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={loading || page >= totalPages}
                                onClick={() => void fetchLogs(page + 1)}
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
