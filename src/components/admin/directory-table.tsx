"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    Download,
    KeyRound,
    Loader2,
    Search,
    ShieldAlert,
    ShieldCheck,
    ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import type { AccountStatus, SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface DirectoryUserItem {
    id: string;
    studentIdNumber: string;
    fullName: string;
    universityEmail: string | null;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
    statusReason: string | null;
    appointments: Array<{
        positionTitle: string;
        grantedSystemRole: string;
        isCurrent: boolean;
    }>;
}

export interface TermOption {
    id: string;
    code: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
}

interface DirectoryTableProps {
    isSuperAdmin: boolean;
    initialItems: DirectoryUserItem[];
    initialTotal: number;
    terms: TermOption[];
    initialTermId: string;
}

function StatusBadge({ status }: { status: AccountStatus }) {
    if (status === "ACTIVE") {
        return (
            <Badge variant="success">
                <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                ACTIVE
            </Badge>
        );
    }
    if (status === "NEEDS_REVIEW") {
        return (
            <Badge variant="warning">
                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                NEEDS_REVIEW
            </Badge>
        );
    }
    return (
        <Badge variant="destructive">
            <ShieldOff className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            DISABLED
        </Badge>
    );
}

export function DirectoryTable({
    isSuperAdmin,
    initialItems,
    initialTotal,
    terms,
    initialTermId,
}: DirectoryTableProps) {
    const router = useRouter();
    const [items, setItems] = useState<DirectoryUserItem[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [roleFilter, setRoleFilter] = useState("");
    const [termId, setTermId] = useState(initialTermId);
    const [loading, setLoading] = useState(false);

    // Selected user for Super Admin lifecycle actions
    const [managedUser, setManagedUser] = useState<DirectoryUserItem | null>(null);
    const [nextStatus, setNextStatus] = useState<AccountStatus>("ACTIVE");
    const [reason, setReason] = useState("");
    const [savingAction, setSavingAction] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    function buildQueryParams() {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (statusFilter) params.set("status", statusFilter);
        if (roleFilter) params.set("role", roleFilter);
        if (termId) params.set("termId", termId);
        return params;
    }

    async function fetchDirectory(event?: FormEvent<HTMLFormElement>) {
        event?.preventDefault();
        setLoading(true);
        setErrorMsg(null);
        try {
            const params = buildQueryParams();
            const res = await fetch(`${ROUTES.api.adminDirectory}?${params.toString()}`);
            const payload = (await res.json()) as {
                data?: { items: DirectoryUserItem[]; pagination: { total: number } };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to search directory.");
                return;
            }
            setItems(payload.data.items);
            setTotal(payload.data.pagination.total);
        } finally {
            setLoading(false);
        }
    }

    async function handleStatusUpdate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!managedUser) return;
        setErrorMsg(null);
        setSavingAction(true);

        try {
            const res = await fetch(`${ROUTES.api.adminUsers}/${managedUser.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountStatus: nextStatus, reason }),
            });
            const payload = (await res.json()) as {
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to update account status.");
                return;
            }
            toast.success(`${managedUser.studentIdNumber} updated to ${nextStatus}.`);
            setManagedUser(null);
            setReason("");
            await fetchDirectory();
            router.refresh();
        } finally {
            setSavingAction(false);
        }
    }

    async function handleAdminPasswordReset() {
        if (!managedUser) return;
        setErrorMsg(null);
        setSavingAction(true);
        try {
            const res = await fetch(`${ROUTES.api.adminUsers}/${managedUser.id}/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            const payload = (await res.json()) as {
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to reset password.");
                return;
            }
            toast.success(
                `Password reset to normalized default for ${managedUser.studentIdNumber}. Active sessions revoked.`,
            );
            setManagedUser(null);
            setReason("");
            router.refresh();
        } finally {
            setSavingAction(false);
        }
    }

    const exportHref = `${ROUTES.api.adminDirectory}/export?${buildQueryParams().toString()}`;

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
                    <form onSubmit={fetchDirectory} className="grid gap-3 md:grid-cols-5">
                        <div className="relative md:col-span-2">
                            <Search
                                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                            <Input
                                aria-label="Search Student ID, name, or email"
                                placeholder="Search Student ID, name, or email..."
                                className="pl-9"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                            />
                        </div>
                        <select
                            aria-label="Filter by account status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                        >
                            <option value="">All Statuses</option>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                            <option value="DISABLED">DISABLED</option>
                        </select>
                        <select
                            aria-label="Filter by system role"
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                            className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                        >
                            <option value="">All Roles</option>
                            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                            <option value="EXECUTIVE">EXECUTIVE</option>
                            <option value="OFFICER">OFFICER</option>
                            <option value="MEMBER">MEMBER</option>
                        </select>
                        <div className="flex gap-2">
                            <select
                                aria-label="Filter appointments by academic term"
                                value={termId}
                                onChange={(e) => setTermId(e.target.value)}
                                className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-muted px-2.5 font-mono text-xs sm:min-h-10"
                            >
                                {terms.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.code}
                                    </option>
                                ))}
                            </select>
                            <Button type="submit" disabled={loading}>
                                {loading ? (
                                    <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                                ) : (
                                    "Filter"
                                )}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {isSuperAdmin && managedUser ? (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Manage Account &mdash;{" "}
                            <span className="font-mono">{managedUser.studentIdNumber}</span> (
                            {managedUser.fullName})
                        </CardTitle>
                        <CardDescription>
                            All status transitions and administrative resets require an audit reason
                            and immediately revoke active sessions when leaving ACTIVE.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleStatusUpdate} className="grid gap-3 md:grid-cols-4">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="manage-status" className="text-xs font-medium">
                                    Account Status
                                </label>
                                <select
                                    id="manage-status"
                                    value={nextStatus}
                                    onChange={(e) => setNextStatus(e.target.value as AccountStatus)}
                                    className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                                >
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                                    <option value="DISABLED">DISABLED</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5 md:col-span-2">
                                <label htmlFor="manage-reason" className="text-xs font-medium">
                                    Audit Reason (min 5 chars)
                                </label>
                                <Input
                                    id="manage-reason"
                                    placeholder="e.g., Graduated BSIT 2026 or verified ID in person"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="flex flex-wrap items-end gap-2">
                                <Button type="submit" disabled={savingAction || reason.trim().length < 5}>
                                    Save Status
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={savingAction || reason.trim().length < 5}
                                    onClick={handleAdminPasswordReset}
                                >
                                    <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                    Reset Password
                                </Button>
                                <Button variant="ghost" onClick={() => setManagedUser(null)}>
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
                    <span>
                        Showing <span className="font-mono text-foreground">{items.length}</span> of{" "}
                        <span className="font-mono text-foreground">{total}</span> accounts
                    </span>
                    <a
                        href={exportHref}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted sm:min-h-9"
                    >
                        <Download className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Export CSV</span>
                    </a>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3">Student ID</th>
                                <th className="px-4 py-3">Name &amp; Email</th>
                                <th className="px-4 py-3">Role</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Term Appointment</th>
                                {isSuperAdmin ? (
                                    <th className="px-4 py-3 text-right">Custody</th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {items.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={isSuperAdmin ? 6 : 5}
                                        className="px-4 py-8 text-center text-muted-foreground"
                                    >
                                        No matching accounts found.
                                    </td>
                                </tr>
                            ) : (
                                items.map((u) => (
                                    <tr key={u.id}>
                                        <td className="px-4 py-3 font-mono text-xs font-medium">
                                            {u.studentIdNumber}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium">{u.fullName}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {u.universityEmail ?? "Unverified email"}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge variant="brand">{u.systemRole}</Badge>
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusBadge status={u.accountStatus} />
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">
                                            {u.appointments.length > 0
                                                ? u.appointments
                                                      .map((a) => a.positionTitle)
                                                      .join(", ")
                                                : "General Member"}
                                        </td>
                                        {isSuperAdmin ? (
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => {
                                                        setManagedUser(u);
                                                        setNextStatus(u.accountStatus);
                                                        setReason("");
                                                    }}
                                                >
                                                    Manage
                                                </Button>
                                            </td>
                                        ) : null}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
