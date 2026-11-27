"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import {
    isoToManilaDateTimeLocal,
    manilaDateTimeLocalToIso,
    type MeetingDetailDto,
} from "@/app/api/meetings/_lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MeetingRichTextEditor } from "./meeting-rich-text-editor";

export interface MeetingFormDialogProps {
    open: boolean;
    userRole: SystemRole;
    initialMeeting?: MeetingDetailDto | null;
    onClose: () => void;
    onSuccess: (meeting: MeetingDetailDto) => void;
}

export function MeetingFormDialog(props: MeetingFormDialogProps) {
    if (!props.open) {
        return null;
    }
    return (
        <MeetingFormDialogBody
            key={props.initialMeeting?.id ?? "create"}
            {...props}
        />
    );
}

function MeetingFormDialogBody({
    userRole,
    initialMeeting = null,
    onClose,
    onSuccess,
}: MeetingFormDialogProps) {
    const isEdit = Boolean(initialMeeting);
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    const [title, setTitle] = useState(initialMeeting?.title ?? "");
    const [startLocal, setStartLocal] = useState(
        isoToManilaDateTimeLocal(initialMeeting?.scheduledStartAt),
    );
    const [endLocal, setEndLocal] = useState(
        isoToManilaDateTimeLocal(initialMeeting?.scheduledEndAt),
    );
    const [locationOrLink, setLocationOrLink] = useState(initialMeeting?.locationOrLink ?? "");
    const [agendaHtml, setAgendaHtml] = useState(initialMeeting?.agendaHtml ?? "");
    const [breakGlassReason, setBreakGlassReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !saving) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose, saving]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);

        const startIso = manilaDateTimeLocalToIso(startLocal);
        if (!startIso) {
            setErrorMsg("Provide a valid scheduled start date and time (PHT).");
            return;
        }
        const endIso = endLocal.trim() ? manilaDateTimeLocalToIso(endLocal) : null;
        if (endLocal.trim() && !endIso) {
            setErrorMsg("Provide a valid scheduled end date and time (PHT).");
            return;
        }
        if (endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
            setErrorMsg("Scheduled end time must be on or after start time.");
            return;
        }
        if (isSuperAdmin && breakGlassReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass override requires at least 10 characters.");
            return;
        }

        setSaving(true);
        try {
            const url = isEdit
                ? `${ROUTES.api.meetings}/${initialMeeting!.id}`
                : ROUTES.api.meetings;
            const method = isEdit ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    scheduledStartAt: startIso,
                    scheduledEndAt: endIso,
                    locationOrLink: locationOrLink.trim() || null,
                    agendaHtml: agendaHtml.trim() || null,
                    ...(isSuperAdmin
                        ? { breakGlass: true, reason: breakGlassReason.trim() }
                        : {}),
                }),
            });

            const payload = (await res.json()) as {
                data?: { meeting: MeetingDetailDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data?.meeting) {
                setErrorMsg(payload.error?.message ?? "Failed to save officer meeting.");
                return;
            }
            toast.success(isEdit ? "Officer meeting updated." : "Officer meeting scheduled.");
            onSuccess(payload.data.meeting);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-form-title"
        >
            <div
                className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                style={{ boxShadow: "var(--shadow-overlay-md)" }}
            >
                <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div>
                        <h2 id="meeting-form-title" className="text-base font-semibold">
                            {isEdit ? "Edit Meeting Details & Agenda" : "Schedule Officer Meeting"}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            All meeting times are entered in Asia/Manila (PHT) and stored in UTC.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving}
                        aria-label="Close meeting dialog"
                        onClick={onClose}
                    >
                        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </div>

                {errorMsg ? (
                    <div
                        role="alert"
                        aria-live="polite"
                        className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
                    >
                        <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span>{errorMsg}</span>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="meeting-title-input" className="text-xs font-medium">
                            Meeting Title
                        </label>
                        <Input
                            id="meeting-title-input"
                            required
                            maxLength={200}
                            disabled={saving}
                            placeholder="e.g., 1st General Officers Assembly"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="meeting-start-input" className="text-xs font-medium">
                                Scheduled Start (PHT)
                            </label>
                            <Input
                                id="meeting-start-input"
                                type="datetime-local"
                                required
                                disabled={saving}
                                className="font-mono text-xs"
                                value={startLocal}
                                onChange={(e) => setStartLocal(e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="meeting-end-input" className="text-xs font-medium">
                                Scheduled End (PHT, Optional)
                            </label>
                            <Input
                                id="meeting-end-input"
                                type="datetime-local"
                                disabled={saving}
                                className="font-mono text-xs"
                                value={endLocal}
                                onChange={(e) => setEndLocal(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="meeting-location-input" className="text-xs font-medium">
                            Location or Video Link (Optional)
                        </label>
                        <Input
                            id="meeting-location-input"
                            maxLength={255}
                            disabled={saving}
                            placeholder="e.g., CCS Faculty Room / Google Meet link"
                            value={locationOrLink}
                            onChange={(e) => setLocationOrLink(e.target.value)}
                        />
                    </div>

                    <MeetingRichTextEditor
                        id="meeting-agenda-editor"
                        label="Meeting Agenda (Optional)"
                        value={agendaHtml}
                        onChange={setAgendaHtml}
                        disabled={saving}
                        placeholder="<p>1. Call to Order...</p>"
                    />

                    {isSuperAdmin ? (
                        <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-3">
                            <label
                                htmlFor="meeting-bg-reason"
                                className="flex items-center gap-1.5 text-xs font-medium text-warning"
                            >
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Super Admin Break-Glass Reason (min 10 chars)
                            </label>
                            <Input
                                id="meeting-bg-reason"
                                required
                                disabled={saving}
                                value={breakGlassReason}
                                onChange={(e) => setBreakGlassReason(e.target.value)}
                                placeholder="Explain why Super Admin is scheduling or modifying this meeting..."
                            />
                        </div>
                    ) : null}

                    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                saving ||
                                title.trim().length < 2 ||
                                !startLocal ||
                                (isSuperAdmin && breakGlassReason.trim().length < 10)
                            }
                        >
                            {saving
                                ? "Saving..."
                                : isEdit
                                  ? "Save Changes"
                                  : "Schedule Meeting"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
