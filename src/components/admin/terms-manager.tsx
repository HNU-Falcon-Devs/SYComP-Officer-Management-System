"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    Archive,
    CalendarPlus,
    CheckCircle2,
    Loader2,
    Lock,
    PlayCircle,
    ShieldAlert,
    UserMinus,
    UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface TermDto {
    id: string;
    code: string;
    name: string;
    startDate: string;
    endDate: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
    appointmentCount: number;
}

export interface AppointmentDto {
    id: string;
    userId: string;
    academicTermId: string;
    positionTitle: string;
    grantedSystemRole: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER";
    isCurrent: boolean;
    appointedAt: string;
    endedAt: string | null;
    studentIdNumber: string;
    fullName: string;
    userSystemRole: SystemRole;
}

export interface ActiveUserOption {
    id: string;
    studentIdNumber: string;
    fullName: string;
    systemRole: SystemRole;
}

interface TermsManagerProps {
    isSuperAdmin: boolean;
    initialTerms: TermDto[];
    initialSelectedTermId: string | null;
    initialAppointments: AppointmentDto[];
    activeUsers: ActiveUserOption[];
}

function TermStatusBadge({ status }: { status: TermDto["status"] }) {
    if (status === "ACTIVE") {
        return (
            <Badge variant="success">
                <PlayCircle className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                ACTIVE
            </Badge>
        );
    }
    if (status === "CLOSED") {
        return (
            <Badge variant="neutral">
                <Archive className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                CLOSED
            </Badge>
        );
    }
    return (
        <Badge variant="warning">
            <CalendarPlus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            DRAFT
        </Badge>
    );
}

export function TermsManager({
    isSuperAdmin,
    initialTerms,
    initialSelectedTermId,
    initialAppointments,
    activeUsers,
}: TermsManagerProps) {
    const router = useRouter();
    const [terms, setTerms] = useState<TermDto[]>(initialTerms);
    const [selectedTermId, setSelectedTermId] = useState<string | null>(initialSelectedTermId);
    const [appointments, setAppointments] = useState<AppointmentDto[]>(initialAppointments);
    const [loadingAppts, setLoadingAppts] = useState(false);

    // Create Draft Term form
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [creatingTerm, setCreatingTerm] = useState(false);
    const [termActionLoadingId, setTermActionLoadingId] = useState<string | null>(null);

    // Appoint Officer form
    const [userId, setUserId] = useState(activeUsers[0]?.id ?? "");
    const [positionTitle, setPositionTitle] = useState("");
    const [grantedSystemRole, setGrantedSystemRole] = useState<"OFFICER" | "EXECUTIVE" | "SUPER_ADMIN">("OFFICER");
    const [breakGlassReason, setBreakGlassReason] = useState("");
    const [appointing, setAppointing] = useState(false);
    const [endingId, setEndingId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

    async function refreshTermsAndAppointments(termId: string | null) {
        const termsRes = await fetch(ROUTES.api.adminTerms);
        if (termsRes.ok) {
            const payload = (await termsRes.json()) as { data: { terms: TermDto[] } };
            setTerms(payload.data.terms);
        }
        if (termId) {
            await loadAppointments(termId);
        }
        router.refresh();
    }

    async function loadAppointments(termId: string) {
        setSelectedTermId(termId);
        setLoadingAppts(true);
        try {
            const res = await fetch(`${ROUTES.api.adminTerms}/${termId}/appointments`);
            const payload = (await res.json()) as {
                data?: { appointments: AppointmentDto[] };
                error?: { message?: string };
            };
            if (!res.ok) {
                toast.error(payload.error?.message ?? "Failed to load appointments.");
                return;
            }
            setAppointments(payload.data?.appointments ?? []);
        } finally {
            setLoadingAppts(false);
        }
    }

    async function handleCreateTerm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);
        setCreatingTerm(true);

        try {
            const res = await fetch(ROUTES.api.adminTerms, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, name, startDate, endDate }),
            });
            const payload = (await res.json()) as {
                data?: { term: TermDto };
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Unable to create academic term.");
                return;
            }
            setCode("");
            setName("");
            setStartDate("");
            setEndDate("");
            toast.success(`Draft term ${payload.data?.term.code} created.`);
            await refreshTermsAndAppointments(payload.data?.term.id ?? selectedTermId);
        } finally {
            setCreatingTerm(false);
        }
    }

    async function handleTermTransition(term: TermDto, action: "activate" | "close") {
        setErrorMsg(null);
        setTermActionLoadingId(term.id);
        try {
            const res = await fetch(`${ROUTES.api.adminTerms}/${term.id}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const payload = (await res.json()) as {
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? `Failed to ${action} term.`);
                return;
            }
            toast.success(
                action === "activate"
                    ? `Term ${term.code} is now ACTIVE.`
                    : `Term ${term.code} is now CLOSED.`,
            );
            await refreshTermsAndAppointments(term.id);
        } finally {
            setTermActionLoadingId(null);
        }
    }

    async function handleAppointOfficer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedTerm) return;
        setErrorMsg(null);
        setAppointing(true);

        const needsBreakGlass = selectedTerm.status === "CLOSED";
        try {
            const res = await fetch(`${ROUTES.api.adminTerms}/${selectedTerm.id}/appointments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    positionTitle,
                    grantedSystemRole,
                    ...(needsBreakGlass
                        ? { breakGlass: true, reason: breakGlassReason.trim() }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to appoint officer.");
                return;
            }
            setPositionTitle("");
            setBreakGlassReason("");
            toast.success("Officer appointment recorded.");
            await refreshTermsAndAppointments(selectedTerm.id);
        } finally {
            setAppointing(false);
        }
    }

    async function handleEndAppointment(appt: AppointmentDto) {
        if (!selectedTerm) return;
        setErrorMsg(null);
        setEndingId(appt.id);
        const needsBreakGlass = selectedTerm.status === "CLOSED";

        try {
            const res = await fetch(
                `${ROUTES.api.adminTerms}/${selectedTerm.id}/appointments/${appt.id}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "END",
                        ...(needsBreakGlass
                            ? { breakGlass: true, reason: breakGlassReason.trim() }
                            : {}),
                    }),
                },
            );
            const payload = (await res.json()) as {
                data?: {
                    headedActiveCommittees?: Array<{ committeeName: string; eventTitle: string }>;
                };
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Failed to end appointment.");
                return;
            }

            const headed = payload.data?.headedActiveCommittees ?? [];
            if (headed.length > 0) {
                toast.warning(
                    `Appointment ended. Reassign Committee Head for ${headed.map((h) => h.committeeName).join(", ")}.`,
                );
            } else {
                toast.success(`Ended ${appt.positionTitle} appointment for ${appt.fullName}.`);
            }
            await refreshTermsAndAppointments(selectedTerm.id);
        } finally {
            setEndingId(null);
        }
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

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className={isSuperAdmin ? "lg:col-span-2" : "lg:col-span-3"}>
                    <CardHeader>
                        <CardTitle>Academic Terms Ledger</CardTitle>
                        <CardDescription>
                            At most one term may be ACTIVE. Activating a DRAFT term atomically closes
                            any outgoing active term and archives its officer appointments.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto border-t border-border">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3">Code</th>
                                        <th className="px-4 py-3">Term Name</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Officers</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {terms.map((term) => {
                                        const isSelected = term.id === selectedTermId;
                                        const busy = termActionLoadingId === term.id;
                                        return (
                                            <tr
                                                key={term.id}
                                                className={isSelected ? "bg-brand-soft/40" : undefined}
                                            >
                                                <td className="px-4 py-3 font-mono text-xs font-medium">
                                                    <button
                                                        type="button"
                                                        onClick={() => loadAppointments(term.id)}
                                                        className="text-left hover:underline"
                                                    >
                                                        {term.code}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="font-medium">{term.name}</p>
                                                    <p className="font-mono text-xs text-muted-foreground">
                                                        {term.startDate} to {term.endDate}
                                                    </p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <TermStatusBadge status={term.status} />
                                                </td>
                                                <td className="px-4 py-3 font-mono text-xs">
                                                    {term.appointmentCount}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex flex-wrap justify-end gap-2">
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => loadAppointments(term.id)}
                                                        >
                                                            Inspect
                                                        </Button>
                                                        {isSuperAdmin && term.status === "DRAFT" ? (
                                                            <Button
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() =>
                                                                    handleTermTransition(
                                                                        term,
                                                                        "activate",
                                                                    )
                                                                }
                                                            >
                                                                {busy ? (
                                                                    <Loader2
                                                                        className="size-3.5 animate-spin"
                                                                        strokeWidth={1.75}
                                                                        aria-hidden="true"
                                                                    />
                                                                ) : (
                                                                    <CheckCircle2
                                                                        className="size-3.5"
                                                                        strokeWidth={1.75}
                                                                        aria-hidden="true"
                                                                    />
                                                                )}
                                                                Activate
                                                            </Button>
                                                        ) : null}
                                                        {isSuperAdmin && term.status === "ACTIVE" ? (
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() =>
                                                                    handleTermTransition(
                                                                        term,
                                                                        "close",
                                                                    )
                                                                }
                                                            >
                                                                <Lock
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                Close
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {isSuperAdmin ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>Create Draft Term</CardTitle>
                            <CardDescription>
                                Prepare upcoming semester records and pre-stage officer
                                appointments before rollover.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleCreateTerm} className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="term-code" className="text-xs font-medium">
                                        Term Code
                                    </label>
                                    <Input
                                        id="term-code"
                                        placeholder="AY2026-2027-S2"
                                        className="font-mono"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="term-name" className="text-xs font-medium">
                                        Display Name
                                    </label>
                                    <Input
                                        id="term-name"
                                        placeholder="AY 2026-2027 - 2nd Sem"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="term-start" className="text-xs font-medium">
                                            Start Date
                                        </label>
                                        <Input
                                            id="term-start"
                                            type="date"
                                            className="font-mono"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label htmlFor="term-end" className="text-xs font-medium">
                                            End Date
                                        </label>
                                        <Input
                                            id="term-end"
                                            type="date"
                                            className="font-mono"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            required
                                        />
                                    </div>
                                </div>
                                <Button type="submit" disabled={creatingTerm} className="mt-1">
                                    <CalendarPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                    <span>{creatingTerm ? "Creating..." : "Create Draft Term"}</span>
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                ) : null}
            </div>

            {selectedTerm ? (
                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle>
                                Officer Appointments &mdash;{" "}
                                <span className="font-mono">{selectedTerm.code}</span>
                            </CardTitle>
                            <CardDescription>
                                Organizational titles are historical metadata; global authorization
                                uses the granted system role.
                            </CardDescription>
                        </div>
                        <TermStatusBadge status={selectedTerm.status} />
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                        {isSuperAdmin ? (
                            <form
                                onSubmit={handleAppointOfficer}
                                className="grid gap-3 rounded-lg border border-border bg-muted/50 p-4 md:grid-cols-4"
                            >
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="appt-user" className="text-xs font-medium">
                                        Active User
                                    </label>
                                    <select
                                        id="appt-user"
                                        value={userId}
                                        onChange={(e) => setUserId(e.target.value)}
                                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                                        required
                                    >
                                        {activeUsers.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.studentIdNumber} &mdash; {u.fullName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="appt-title" className="text-xs font-medium">
                                        Position Title (Metadata)
                                    </label>
                                    <Input
                                        id="appt-title"
                                        placeholder="Secretary"
                                        value={positionTitle}
                                        onChange={(e) => setPositionTitle(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="appt-role" className="text-xs font-medium">
                                        Granted System Role
                                    </label>
                                    <select
                                        id="appt-role"
                                        value={grantedSystemRole}
                                        onChange={(e) =>
                                            setGrantedSystemRole(
                                                e.target.value as
                                                    | "OFFICER"
                                                    | "EXECUTIVE"
                                                    | "SUPER_ADMIN",
                                            )
                                        }
                                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                                    >
                                        <option value="OFFICER">OFFICER</option>
                                        <option value="EXECUTIVE">EXECUTIVE</option>
                                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                                    </select>
                                </div>
                                <div className="flex items-end">
                                    <Button type="submit" disabled={appointing || !userId} className="w-full">
                                        <UserPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                        <span>{appointing ? "Saving..." : "Appoint"}</span>
                                    </Button>
                                </div>

                                {selectedTerm.status === "CLOSED" ? (
                                    <div className="flex flex-col gap-1.5 md:col-span-4">
                                        <label
                                            htmlFor="bg-reason"
                                            className="flex items-center gap-1.5 text-xs font-medium text-warning"
                                        >
                                            <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                            Break-Glass Reason Required for Closed Term (min 10 chars)
                                        </label>
                                        <Input
                                            id="bg-reason"
                                            placeholder="Explain why historical term appointments are being amended..."
                                            value={breakGlassReason}
                                            onChange={(e) => setBreakGlassReason(e.target.value)}
                                        />
                                    </div>
                                ) : null}
                            </form>
                        ) : null}

                        <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3">Student ID</th>
                                        <th className="px-4 py-3">Name</th>
                                        <th className="px-4 py-3">Position Title</th>
                                        <th className="px-4 py-3">Granted Role</th>
                                        <th className="px-4 py-3">State</th>
                                        {isSuperAdmin ? (
                                            <th className="px-4 py-3 text-right">Action</th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {loadingAppts ? (
                                        <tr>
                                            <td
                                                colSpan={isSuperAdmin ? 6 : 5}
                                                className="px-4 py-6 text-center text-muted-foreground"
                                            >
                                                Loading appointments...
                                            </td>
                                        </tr>
                                    ) : appointments.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={isSuperAdmin ? 6 : 5}
                                                className="px-4 py-6 text-center text-muted-foreground"
                                            >
                                                No officer appointments recorded for this term.
                                            </td>
                                        </tr>
                                    ) : (
                                        appointments.map((appt) => (
                                            <tr key={appt.id}>
                                                <td className="px-4 py-3 font-mono text-xs">
                                                    {appt.studentIdNumber}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                    {appt.fullName}
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">
                                                    {appt.positionTitle}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge
                                                        variant={
                                                            appt.grantedSystemRole === "EXECUTIVE"
                                                                ? "brand"
                                                                : appt.grantedSystemRole ===
                                                                    "SUPER_ADMIN"
                                                                  ? "warning"
                                                                  : "info"
                                                        }
                                                    >
                                                        {appt.grantedSystemRole}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {appt.isCurrent ? (
                                                        <Badge variant="success">Current</Badge>
                                                    ) : (
                                                        <Badge variant="neutral">Ended</Badge>
                                                    )}
                                                </td>
                                                {isSuperAdmin ? (
                                                    <td className="px-4 py-3 text-right">
                                                        {appt.isCurrent ? (
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                disabled={endingId === appt.id}
                                                                onClick={() =>
                                                                    handleEndAppointment(appt)
                                                                }
                                                            >
                                                                <UserMinus
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                End
                                                            </Button>
                                                        ) : (
                                                            <span className="font-mono text-xs text-muted-foreground">
                                                                {appt.endedAt?.slice(0, 10) ?? ""}
                                                            </span>
                                                        )}
                                                    </td>
                                                ) : null}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}
