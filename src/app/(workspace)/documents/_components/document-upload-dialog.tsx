"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
    AlertCircle,
    FileUp,
    FolderTree,
    Link2,
    Loader2,
    ShieldAlert,
    UploadCloud,
    X,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import {
    ACCEPT_INPUT_ATTR,
    ACCEPTED_FILE_EXTENSIONS,
    resolveDriveFolderPath,
    validateExternalDriveUrl,
    validateUploadFileDescriptor,
} from "@/lib/drive/classifier";
import {
    DOCUMENT_INITIAL_STATUSES,
    formatFileSizeBytes,
    type ActiveDocumentTypeOption,
    type DocumentDto,
    type DocumentEventOption,
    type DocumentInitialStatus,
    type DocumentTermOption,
} from "@/lib/drive/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface DocumentUploadDialogProps {
    open: boolean;
    initialMode?: "upload" | "external";
    userRole: SystemRole;
    documentTypes: ActiveDocumentTypeOption[];
    activeTerm: DocumentTermOption | null;
    events?: DocumentEventOption[];
    lockedEvent?: DocumentEventOption | null;
    lockedMeeting?: {
        id: string;
        title: string;
        status: string;
        academicTermCode: string;
        academicTermName: string;
        academicTermStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    } | null;
    defaultDocTypeSlug?: string;
    allowProposalToggle?: boolean;
    maxUploadSizeBytes: number;
    onClose: () => void;
    onSuccess: (document: DocumentDto) => void;
}

type UploadPhase = "idle" | "init" | "uploading" | "finalize";

export function DocumentUploadDialog(props: DocumentUploadDialogProps) {
    if (!props.open) {
        return null;
    }
    return (
        <DocumentUploadDialogBody
            key={`${props.initialMode ?? "upload"}-${props.lockedEvent?.id ?? props.lockedMeeting?.id ?? "general"}`}
            {...props}
        />
    );
}

function DocumentUploadDialogBody({
    initialMode = "upload",
    userRole,
    documentTypes,
    activeTerm,
    events = [],
    lockedEvent = null,
    lockedMeeting = null,
    defaultDocTypeSlug,
    allowProposalToggle = false,
    maxUploadSizeBytes,
    onClose,
    onSuccess,
}: DocumentUploadDialogProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const defaultType =
        (defaultDocTypeSlug
            ? documentTypes.find((t) => t.slug === defaultDocTypeSlug)
            : undefined) ?? documentTypes[0];

    const [mode, setMode] = useState<"upload" | "external">(initialMode);
    const [title, setTitle] = useState("");
    const [documentTypeId, setDocumentTypeId] = useState(defaultType?.id ?? "");
    const [selectedEventId, setSelectedEventId] = useState(lockedEvent?.id ?? "");
    const [isProposalAttachment, setIsProposalAttachment] = useState(false);
    const [initialStatus, setInitialStatus] = useState<DocumentInitialStatus>("DRAFT");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [externalUrl, setExternalUrl] = useState("");
    const [breakGlassReason, setBreakGlassReason] = useState("");

    const [phase, setPhase] = useState<UploadPhase>("idle");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && phase === "idle") {
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose, phase]);

    const effectiveEvent = useMemo(() => {
        if (lockedEvent) return lockedEvent;
        if (!selectedEventId) return null;
        return events.find((e) => e.id === selectedEventId) ?? null;
    }, [events, lockedEvent, selectedEventId]);

    const selectedDocType = useMemo(
        () => documentTypes.find((t) => t.id === documentTypeId) ?? documentTypes[0] ?? null,
        [documentTypeId, documentTypes],
    );

    const previewPath = useMemo(() => {
        if (!selectedDocType) return null;
        const termName =
            lockedMeeting?.academicTermName ??
            effectiveEvent?.academicTermName ??
            activeTerm?.name ??
            "Active Term";
        const termCode =
            lockedMeeting?.academicTermCode ??
            effectiveEvent?.academicTermCode ??
            activeTerm?.code ??
            "ACTIVE";

        return resolveDriveFolderPath({
            academicTermName: termName,
            academicTermCode: termCode,
            documentTypeSegment: selectedDocType.driveFolderSegment,
            documentTypeSlug: selectedDocType.slug,
            eventTitle: effectiveEvent?.title ?? null,
            eventSlug: effectiveEvent?.slug ?? null,
            isProposal: Boolean(effectiveEvent && isProposalAttachment),
        }).displayPath;
    }, [activeTerm, effectiveEvent, isProposalAttachment, lockedMeeting, selectedDocType]);

    const targetLocked = Boolean(
        lockedMeeting?.academicTermStatus === "CLOSED" ||
            lockedMeeting?.status === "COMPLETED" ||
            lockedMeeting?.status === "CANCELLED" ||
            effectiveEvent?.academicTermStatus === "CLOSED" ||
            effectiveEvent?.status === "COMPLETED" ||
            effectiveEvent?.status === "REJECTED" ||
            (!effectiveEvent && !lockedMeeting && activeTerm?.status === "CLOSED"),
    );
    const needsBreakGlass = targetLocked && userRole === "SUPER_ADMIN";

    const busy = phase !== "idle";
    const maxMbLabel = Math.round((maxUploadSizeBytes / (1024 * 1024)) * 10) / 10;

    function handleFilePicked(file: File | null) {
        setErrorMsg(null);
        if (!file) {
            setSelectedFile(null);
            return;
        }
        const check = validateUploadFileDescriptor({
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSizeBytes: file.size,
            maxUploadSizeBytes,
        });
        if (!check.ok) {
            setErrorMsg(check.message);
            setSelectedFile(null);
            return;
        }
        setSelectedFile(file);
        if (!title.trim()) {
            const stem = file.name.replace(/\.[^.]+$/, "").trim();
            if (stem.length >= 2) {
                setTitle(stem.slice(0, 200));
            }
        }
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files?.[0] ?? null;
        handleFilePicked(file);
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);

        if (!selectedDocType) {
            setErrorMsg("No active document type is available.");
            return;
        }
        if (needsBreakGlass && breakGlassReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass override requires at least 10 characters.");
            return;
        }

        const bgPayload = needsBreakGlass
            ? { breakGlass: true, reason: breakGlassReason.trim() }
            : {};

        if (mode === "external") {
            const urlCheck = validateExternalDriveUrl(externalUrl);
            if (!urlCheck.ok) {
                setErrorMsg(urlCheck.message);
                return;
            }
            setPhase("finalize");
            try {
                const res = await fetch(`${ROUTES.api.documents}/external`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: title.trim(),
                        documentTypeId: selectedDocType.id,
                        eventId: effectiveEvent?.id,
                        meetingId: lockedMeeting?.id,
                        isProposalAttachment: Boolean(effectiveEvent && isProposalAttachment),
                        initialStatus,
                        webViewLink: urlCheck.normalizedUrl,
                        ...bgPayload,
                    }),
                });
                const payload = (await res.json()) as {
                    data?: { document: DocumentDto };
                    error?: { message?: string };
                };
                if (!res.ok || !payload.data?.document) {
                    setErrorMsg(payload.error?.message ?? "Failed to link Google Drive URL.");
                    return;
                }
                toast.success("Google Drive link registered.");
                onSuccess(payload.data.document);
            } finally {
                setPhase("idle");
            }
            return;
        }

        if (!selectedFile) {
            setErrorMsg("Select a file to upload.");
            return;
        }

        try {
            setPhase("init");
            const initRes = await fetch(`${ROUTES.api.documents}/upload-init`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    documentTypeId: selectedDocType.id,
                    eventId: effectiveEvent?.id,
                    meetingId: lockedMeeting?.id,
                    isProposalAttachment: Boolean(effectiveEvent && isProposalAttachment),
                    initialStatus,
                    filename: selectedFile.name,
                    mimeType: selectedFile.type || "application/octet-stream",
                    fileSizeBytes: selectedFile.size,
                    ...bgPayload,
                }),
            });

            const initPayload = (await initRes.json()) as {
                data?: {
                    uploadUrl: string;
                    uploadIntentToken: string;
                };
                error?: { message?: string };
            };
            if (!initRes.ok || !initPayload.data) {
                setErrorMsg(initPayload.error?.message ?? "Failed to initialize Drive upload.");
                return;
            }

            setPhase("uploading");
            const putRes = await fetch(initPayload.data.uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": selectedFile.type || "application/octet-stream",
                },
                body: selectedFile,
            });
            const putPayload = (await putRes.json().catch(() => null)) as
                | { id?: string; data?: { id?: string }; error?: { message?: string } }
                | null;

            const driveFileId = putPayload?.data?.id ?? putPayload?.id;
            if (!putRes.ok || !driveFileId) {
                setErrorMsg(
                    putPayload?.error?.message ??
                        "Direct upload to Google Drive failed. Please try again.",
                );
                return;
            }

            setPhase("finalize");
            const finalizeRes = await fetch(`${ROUTES.api.documents}/upload-finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    driveFileId,
                    uploadIntentToken: initPayload.data.uploadIntentToken,
                    ...bgPayload,
                }),
            });
            const finalizePayload = (await finalizeRes.json()) as {
                data?: { document: DocumentDto };
                error?: { message?: string };
            };
            if (!finalizeRes.ok || !finalizePayload.data?.document) {
                setErrorMsg(finalizePayload.error?.message ?? "Failed to finalize document upload.");
                return;
            }

            toast.success("Document uploaded and classified in Google Drive.");
            onSuccess(finalizePayload.data.document);
        } finally {
            setPhase("idle");
        }
    }

    const canSelectProposal = Boolean(
        effectiveEvent &&
            (allowProposalToggle ||
                effectiveEvent.status === "DRAFT" ||
                effectiveEvent.status === "NEEDS_REVISION"),
    );

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-upload-title"
        >
            <div
                className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                style={{ boxShadow: "var(--shadow-overlay-md)" }}
            >
                <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div>
                        <h2 id="doc-upload-title" className="text-base font-semibold">
                            {mode === "upload" ? "Upload Document to Drive" : "Register Google Drive Link"}
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Files classify automatically into SYComP&apos;s Google Drive folder hierarchy.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label="Close document dialog"
                        onClick={onClose}
                    >
                        <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted p-1">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setMode("upload");
                            setErrorMsg(null);
                        }}
                        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors sm:min-h-9 ${
                            mode === "upload"
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>Direct Upload</span>
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setMode("external");
                            setErrorMsg(null);
                        }}
                        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors sm:min-h-9 ${
                            mode === "external"
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                        <span>External Drive URL</span>
                    </button>
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
                        <label htmlFor="doc-title-input" className="text-xs font-medium">
                            Document Title
                        </label>
                        <Input
                            id="doc-title-input"
                            required
                            maxLength={200}
                            disabled={busy}
                            placeholder="e.g., Barder Hall Venue Reservation Letter"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="doc-type-select" className="text-xs font-medium">
                                Document Type
                            </label>
                            <select
                                id="doc-type-select"
                                disabled={busy || documentTypes.length === 0}
                                value={documentTypeId}
                                onChange={(e) => setDocumentTypeId(e.target.value)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                {documentTypes.map((dt) => (
                                    <option key={dt.id} value={dt.id}>
                                        {dt.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="doc-initial-status" className="text-xs font-medium">
                                Initial Status
                            </label>
                            <select
                                id="doc-initial-status"
                                disabled={busy}
                                value={initialStatus}
                                onChange={(e) => setInitialStatus(e.target.value as DocumentInitialStatus)}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                {DOCUMENT_INITIAL_STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                        {st === "FOR_REVIEW" ? "FOR REVIEW" : st}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {!lockedEvent && !lockedMeeting ? (
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="doc-event-select" className="text-xs font-medium">
                                Linked Event (Optional)
                            </label>
                            <select
                                id="doc-event-select"
                                disabled={busy}
                                value={selectedEventId}
                                onChange={(e) => {
                                    setSelectedEventId(e.target.value);
                                    if (!e.target.value) setIsProposalAttachment(false);
                                }}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm text-foreground sm:min-h-10"
                            >
                                <option value="">General Organizational Document (No Event)</option>
                                {events.map((ev) => (
                                    <option key={ev.id} value={ev.id}>
                                        {ev.title} ({ev.status})
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}

                    {canSelectProposal ? (
                        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-medium sm:min-h-10">
                            <input
                                type="checkbox"
                                disabled={busy}
                                checked={isProposalAttachment}
                                onChange={(e) => setIsProposalAttachment(e.target.checked)}
                                className="size-4 accent-primary"
                            />
                            <span>
                                Mark as Event Proposal Attachment (routes to{" "}
                                <span className="font-mono">Proposals</span> folder)
                            </span>
                        </label>
                    ) : null}

                    {mode === "upload" && previewPath ? (
                        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/60 px-3 py-2.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <FolderTree className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Google Drive Destination Path
                            </span>
                            <span className="break-all font-mono text-xs text-foreground">
                                {previewPath}
                            </span>
                        </div>
                    ) : null}

                    {mode === "upload" ? (
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={handleDrop}
                            className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
                                dragActive
                                    ? "border-primary bg-brand-soft/40"
                                    : "border-border bg-muted/40"
                            }`}
                        >
                            <UploadCloud
                                className="size-8 text-muted-foreground"
                                strokeWidth={1.75}
                                aria-hidden="true"
                            />
                            {selectedFile ? (
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm font-medium text-foreground">
                                        {selectedFile.name}
                                    </span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {formatFileSizeBytes(selectedFile.size)}
                                    </span>
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Drag and drop a file here, or choose from your device.
                                </p>
                            )}
                            <p className="font-mono text-xs text-muted-foreground">
                                {ACCEPTED_FILE_EXTENSIONS.join(", ")} &bull; Max {maxMbLabel} MB
                            </p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={ACCEPT_INPUT_ATTR}
                                disabled={busy}
                                className="sr-only"
                                aria-label="Choose document file"
                                onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {selectedFile ? "Change File" : "Browse File"}
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="doc-external-url" className="text-xs font-medium">
                                Google Drive / Docs URL
                            </label>
                            <Input
                                id="doc-external-url"
                                type="url"
                                required
                                disabled={busy}
                                className="font-mono text-xs"
                                placeholder="https://docs.google.com/document/d/..."
                                value={externalUrl}
                                onChange={(e) => setExternalUrl(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Must point strictly to <span className="font-mono">drive.google.com</span>{" "}
                                or <span className="font-mono">docs.google.com</span>.
                            </p>
                        </div>
                    )}

                    {needsBreakGlass ? (
                        <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-3">
                            <label
                                htmlFor="doc-upload-bg-reason"
                                className="flex items-center gap-1.5 text-xs font-medium text-warning"
                            >
                                <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                Super Admin Break-Glass Reason (locked term/session, min 10 chars)
                            </label>
                            <Input
                                id="doc-upload-bg-reason"
                                required
                                disabled={busy}
                                value={breakGlassReason}
                                onChange={(e) => setBreakGlassReason(e.target.value)}
                                placeholder="Explain why Super Admin is adding a document to a locked record..."
                            />
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                        {busy ? (
                            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                                {phase === "init"
                                    ? "Preparing Drive folder..."
                                    : phase === "uploading"
                                      ? "Uploading bytes to Google Drive..."
                                      : "Verifying & saving metadata..."}
                            </span>
                        ) : null}
                        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                busy ||
                                documentTypes.length === 0 ||
                                (mode === "upload" && !selectedFile) ||
                                (needsBreakGlass && breakGlassReason.trim().length < 10)
                            }
                        >
                            {busy
                                ? "Submitting..."
                                : mode === "upload"
                                  ? "Upload to Drive"
                                  : "Save Drive Link"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
