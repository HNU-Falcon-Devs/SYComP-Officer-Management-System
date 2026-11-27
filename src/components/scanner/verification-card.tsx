"use client";

import { useState } from "react";
import {
    CheckCircle2,
    ClockAlert,
    Loader2,
    Lock,
    RotateCcw,
    ShieldAlert,
    ShieldCheck,
    Users,
    UserX,
} from "lucide-react";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import type { LookupVerificationDto } from "@/lib/attendance/validation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VerificationCardProps {
    result: LookupVerificationDto;
    isOnline: boolean;
    confirming: boolean;
    onConfirm: (breakGlassReason?: string) => void;
    onReset: () => void;
}

export function VerificationCard({
    result,
    isOnline,
    confirming,
    onConfirm,
    onReset,
}: VerificationCardProps) {
    const [breakGlassReason, setBreakGlassReason] = useState("");
    const trimmedReason = breakGlassReason.trim();
    const needsBreakGlass = result.verificationState === "READY" && result.requiresBreakGlass;
    const canConfirm =
        result.verificationState === "READY" &&
        isOnline &&
        !confirming &&
        (!needsBreakGlass || trimmedReason.length >= 10);

    const borderClass =
        result.verificationState === "READY"
            ? "border-2 border-success"
            : result.verificationState === "ALREADY_LOGGED"
              ? "border-2 border-warning"
              : result.verificationState === "OFFICER_RESTRICTED" ||
                  result.verificationState === "ACCOUNT_HOLD"
                ? "border-2 border-destructive"
                : "border-2 border-border";

    return (
        <div
            aria-live="polite"
            className={cn(
                "flex flex-col gap-4 rounded-xl bg-card p-4 text-card-foreground",
                borderClass,
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold leading-snug">
                        {result.target ? result.target.fullName : "Unrecognized Student ID"}
                    </h3>
                    {result.target ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                            ID:{" "}
                            <span className="font-mono font-medium text-foreground">
                                {result.target.studentIdNumber}
                            </span>{" "}
                            &middot; Role:{" "}
                            <span className="font-medium text-foreground">
                                {result.target.systemRole}
                            </span>
                        </p>
                    ) : null}
                </div>

                {result.verificationState === "READY" ? (
                    <Badge variant="success">
                        <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        READY
                    </Badge>
                ) : result.verificationState === "ALREADY_LOGGED" ? (
                    <Badge variant="warning">
                        <ClockAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        ALREADY LOGGED
                    </Badge>
                ) : result.verificationState === "OFFICER_RESTRICTED" ? (
                    <Badge variant="destructive">
                        <Lock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        OFFICER RESTRICTED
                    </Badge>
                ) : result.verificationState === "ACCOUNT_HOLD" ? (
                    <Badge variant="destructive">
                        <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        {result.target?.accountStatus ?? "ACCOUNT HOLD"}
                    </Badge>
                ) : result.verificationState === "AUDIENCE_MISMATCH" ? (
                    <Badge variant="neutral">
                        <Users className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        SCOPE MISMATCH
                    </Badge>
                ) : (
                    <Badge variant="neutral">
                        <UserX className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        NOT FOUND
                    </Badge>
                )}
            </div>

            <div className="rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
                <p className="font-medium">
                    Checkpoint: {result.checkpoint.label} ({result.checkpoint.parentTitle})
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
                {result.existingRecord ? (
                    <p className="mt-1 font-mono text-xs text-foreground">
                        Logged at {formatManilaTimestamp(result.existingRecord.recordedAt)} (
                        {result.existingRecord.status})
                    </p>
                ) : null}
            </div>

            {needsBreakGlass ? (
                <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                        <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span>Break-Glass Administrative Override</span>
                    </div>
                    <label htmlFor="scanner-bg-reason" className="text-xs font-medium">
                        Audit Reason (Required, min 10 characters)
                    </label>
                    <textarea
                        id="scanner-bg-reason"
                        rows={2}
                        value={breakGlassReason}
                        onChange={(e) => setBreakGlassReason(e.target.value)}
                        placeholder="Explain why Super Admin is logging this scan directly..."
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-brand-accent"
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                        {trimmedReason.length}/10 min characters
                    </span>
                </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
                <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={confirming}
                    onClick={onReset}
                >
                    <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    <span>
                        {result.verificationState === "READY" ? "Cancel / Rescan" : "Scan Next"}
                    </span>
                </Button>

                {result.verificationState === "READY" ? (
                    <Button
                        type="button"
                        className="min-h-11"
                        disabled={!canConfirm}
                        onClick={() => onConfirm(needsBreakGlass ? trimmedReason : undefined)}
                    >
                        {confirming ? (
                            <Loader2
                                className="size-4 animate-spin"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                        ) : (
                            <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        )}
                        <span>{confirming ? "Confirming..." : "Confirm Attendance"}</span>
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
