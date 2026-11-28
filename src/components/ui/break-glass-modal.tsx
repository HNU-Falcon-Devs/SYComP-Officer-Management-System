"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BreakGlassModalProps {
    open: boolean;
    actionLabel: string;
    targetLabel: string;
    submitting?: boolean;
    onCancel: () => void;
    onConfirm: (reason: string) => void | Promise<void>;
}

export function BreakGlassModal(props: BreakGlassModalProps) {
    if (!props.open) {
        return null;
    }
    return <BreakGlassModalBody {...props} />;
}

function BreakGlassModalBody({
    actionLabel,
    targetLabel,
    submitting = false,
    onCancel,
    onConfirm,
}: BreakGlassModalProps) {
    const [reason, setReason] = useState("");

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !submitting) {
                onCancel();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onCancel, submitting]);

    const trimmedLength = reason.trim().length;
    const canSubmit = trimmedLength >= 10 && !submitting;

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!canSubmit) return;
        void onConfirm(reason.trim());
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bg-modal-title"
        >
            <div
                className="w-full max-w-lg rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                style={{ boxShadow: "var(--shadow-overlay-md)" }}
            >
                <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div className="flex items-center gap-2 text-warning">
                        <ShieldAlert className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <h2 id="bg-modal-title" className="text-base font-semibold text-foreground">
                            Break-Glass Administrative Override
                        </h2>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={submitting}
                        aria-label="Close break-glass modal"
                        onClick={onCancel}
                    >
                        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">Action:</span>
                            <span className="font-mono text-xs font-medium text-foreground">
                                {actionLabel}
                            </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-foreground">{targetLabel}</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <label htmlFor="bg-modal-reason" className="text-xs font-medium">
                                Audit Reason (Required)
                            </label>
                            <span className="font-mono text-xs text-muted-foreground">
                                {trimmedLength} / 10 min
                            </span>
                        </div>
                        <textarea
                            id="bg-modal-reason"
                            rows={3}
                            required
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Document the administrative justification for this override..."
                            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-accent"
                        />
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={submitting}
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" variant="destructive" disabled={!canSubmit}>
                            {submitting ? "Applying Override..." : "Confirm Override"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
