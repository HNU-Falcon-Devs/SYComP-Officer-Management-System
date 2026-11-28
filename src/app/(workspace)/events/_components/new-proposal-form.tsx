"use client";

import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    ArrowLeft,
    FolderTree,
    Loader2,
    Save,
    Send,
    ShieldAlert,
    UploadCloud,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import {
    ACCEPT_INPUT_ATTR,
    ACCEPTED_FILE_EXTENSIONS,
    resolveDriveFolderPath,
    validateUploadFileDescriptor,
} from "@/lib/drive/classifier";
import {
    formatFileSizeBytes,
    type ActiveDocumentTypeOption,
    type DocumentTermOption,
} from "@/lib/drive/validation";
import { slugifyEventTitle } from "@/app/api/events/_lib/validation";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface NewProposalFormProps {
    activeTerm: DocumentTermOption | null;
    documentTypes: ActiveDocumentTypeOption[];
    maxUploadSizeBytes: number;
    requiresBreakGlass: boolean;
}

export function NewProposalForm({
    activeTerm,
    documentTypes,
    maxUploadSizeBytes,
    requiresBreakGlass,
}: NewProposalFormProps) {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [title, setTitle] = useState("");
    const [startAt, setStartAt] = useState("");
    const [endAt, setEndAt] = useState("");
    const [venue, setVenue] = useState("");
    const [targetAudience, setTargetAudience] = useState("");
    const [publicSummary, setPublicSummary] = useState("");
    const [descriptionHtml, setDescriptionHtml] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [breakGlassReason, setBreakGlassReason] = useState("");

    const [submitting, setSubmitting] = useState(false);
    const [statusNote, setStatusNote] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const defaultDocType = useMemo(() => {
        return (
            documentTypes.find((dt) => dt.slug.includes("proposal")) ??
            documentTypes[0] ??
            null
        );
    }, [documentTypes]);

    const drivePreviewPath = useMemo(() => {
        if (!activeTerm || !defaultDocType) return null;
        const effectiveTitle = title.trim() || "Untitled Proposal";
        return resolveDriveFolderPath({
            academicTermName: activeTerm.name,
            academicTermCode: activeTerm.code,
            documentTypeSegment: defaultDocType.driveFolderSegment,
            documentTypeSlug: defaultDocType.slug,
            eventTitle: effectiveTitle,
            eventSlug: slugifyEventTitle(effectiveTitle),
            isProposal: true,
        }).displayPath;
    }, [activeTerm, defaultDocType, title]);

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
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setDragActive(false);
        handleFilePicked(event.dataTransfer.files?.[0] ?? null);
    }

    async function submitProposal(submitImmediately: boolean) {
        setErrorMsg(null);
        if (!activeTerm) {
            setErrorMsg("An ACTIVE academic term is required before drafting a proposal.");
            return;
        }
        if (requiresBreakGlass && breakGlassReason.trim().length < 10) {
            setErrorMsg("Super Admin break-glass creation requires at least 10 characters.");
            return;
        }
        if (!startAt || !endAt) {
            setErrorMsg("Provide both start and end dates for the event.");
            return;
        }

        const fileCheck = selectedFile
            ? validateUploadFileDescriptor({
                  filename: selectedFile.name,
                  mimeType: selectedFile.type || "application/octet-stream",
                  fileSizeBytes: selectedFile.size,
                  maxUploadSizeBytes,
              })
            : null;
        if (fileCheck && !fileCheck.ok) {
            setErrorMsg(fileCheck.message);
            return;
        }

        setSubmitting(true);
        setStatusNote("Saving event proposal...");
        try {
            const createRes = await fetch(ROUTES.api.events, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    descriptionHtml,
                    publicSummary: publicSummary.trim() || null,
                    venue: venue.trim() || null,
                    targetAudience: targetAudience.trim() || null,
                    startAt: `${startAt}:00+08:00`,
                    endAt: `${endAt}:00+08:00`,
                    submitImmediately,
                    ...(requiresBreakGlass
                        ? { breakGlass: true, reason: breakGlassReason.trim() }
                        : {}),
                }),
            });

            const createPayload = (await createRes.json()) as {
                data?: { event: { id: string; slug: string; title: string } };
                error?: { message?: string };
            };
            if (!createRes.ok || !createPayload.data?.event) {
                setErrorMsg(createPayload.error?.message ?? "Failed to create event proposal.");
                return;
            }

            const createdEvent = createPayload.data.event;

            if (selectedFile && fileCheck?.ok && defaultDocType) {
                setStatusNote("Uploading proposal file to Google Drive...");
                const initRes = await fetch(`${ROUTES.api.documents}/upload-init`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: selectedFile.name.replace(/\.[^.]+$/, "").slice(0, 200) || createdEvent.title,
                        documentTypeId: defaultDocType.id,
                        eventId: createdEvent.id,
                        isProposalAttachment: true,
                        initialStatus: submitImmediately ? "FOR_REVIEW" : "DRAFT",
                        filename: selectedFile.name,
                        mimeType: fileCheck.canonicalMimeType,
                        fileSizeBytes: selectedFile.size,
                    }),
                });
                const initPayload = (await initRes.json()) as {
                    data?: { uploadUrl: string; uploadIntentToken: string };
                    error?: { message?: string };
                };

                if (initRes.ok && initPayload.data) {
                    const putRes = await fetch(initPayload.data.uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Type": fileCheck.canonicalMimeType },
                        body: selectedFile,
                    });
                    const putPayload = (await putRes.json().catch(() => null)) as
                        | { id?: string; data?: { id?: string } }
                        | null;
                    const driveFileId = putPayload?.data?.id ?? putPayload?.id;

                    if (putRes.ok && driveFileId) {
                        const finRes = await fetch(`${ROUTES.api.documents}/upload-finalize`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                driveFileId,
                                uploadIntentToken: initPayload.data.uploadIntentToken,
                            }),
                        });
                        if (!finRes.ok) {
                            toast.warning(
                                "Proposal saved, but the attachment upload failed. You can retry on the Documents tab.",
                            );
                        }
                    } else {
                        toast.warning(
                            "Proposal saved, but direct Drive upload failed. You can retry on the Documents tab.",
                        );
                    }
                } else {
                    toast.warning(
                        initPayload.error?.message ??
                            "Proposal saved, but attachment initialization failed. Upload via the Documents tab.",
                    );
                }
            }

            toast.success(
                submitImmediately
                    ? "Proposal submitted for Executive review."
                    : "Proposal draft created.",
            );
            router.push(ROUTES.workspace.eventDetail(createdEvent.slug));
            router.refresh();
        } catch {
            setErrorMsg("Network error while saving proposal. Please try again.");
        } finally {
            setSubmitting(false);
            setStatusNote(null);
        }
    }

    function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        void submitProposal(false);
    }

    if (!activeTerm) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <AlertCircle
                        className="size-10 text-warning"
                        strokeWidth={1.5}
                        aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                        No Active Academic Term Configured
                    </p>
                    <p className="max-w-md text-xs text-muted-foreground">
                        A Super Admin must activate an academic term before new event proposals can
                        be drafted (BR-SYS-01).
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <Link
                href={ROUTES.workspace.events}
                className="inline-flex min-h-11 w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0"
            >
                <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                <span>Back to Events &amp; Proposals</span>
            </Link>

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
                <CardHeader>
                    <CardTitle>Draft Event Proposal</CardTitle>
                    <CardDescription>
                        Active Term:{" "}
                        <span className="font-mono text-foreground">{activeTerm.code}</span> (
                        {activeTerm.name})
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleFormSubmit} className="flex flex-col gap-5">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="proposal-title" className="text-xs font-medium">
                                Event Title
                            </label>
                            <Input
                                id="proposal-title"
                                required
                                maxLength={200}
                                disabled={submitting}
                                placeholder="e.g., Tech Innovation Summit 2026"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="proposal-start" className="text-xs font-medium">
                                    Proposed Start (PHT)
                                </label>
                                <Input
                                    id="proposal-start"
                                    type="datetime-local"
                                    required
                                    disabled={submitting}
                                    className="font-mono text-xs"
                                    value={startAt}
                                    onChange={(e) => setStartAt(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="proposal-end" className="text-xs font-medium">
                                    Proposed End (PHT)
                                </label>
                                <Input
                                    id="proposal-end"
                                    type="datetime-local"
                                    required
                                    disabled={submitting}
                                    className="font-mono text-xs"
                                    value={endAt}
                                    onChange={(e) => setEndAt(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="proposal-venue" className="text-xs font-medium">
                                    Proposed Venue (Optional for Draft)
                                </label>
                                <Input
                                    id="proposal-venue"
                                    maxLength={255}
                                    disabled={submitting}
                                    placeholder="e.g., HNU Barder Hall"
                                    value={venue}
                                    onChange={(e) => setVenue(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="proposal-audience" className="text-xs font-medium">
                                    Target Audience (Optional)
                                </label>
                                <Input
                                    id="proposal-audience"
                                    maxLength={150}
                                    disabled={submitting}
                                    placeholder="e.g., All BSIT & BSCS Students"
                                    value={targetAudience}
                                    onChange={(e) => setTargetAudience(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="proposal-public-summary" className="text-xs font-medium">
                                Public Member Summary (Optional until Publish)
                            </label>
                            <textarea
                                id="proposal-public-summary"
                                rows={2}
                                maxLength={2000}
                                disabled={submitting}
                                placeholder="Short public description shown to General Members once published..."
                                value={publicSummary}
                                onChange={(e) => setPublicSummary(e.target.value)}
                                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-brand-accent"
                            />
                        </div>

                        <RichTextEditor
                            id="proposal-description"
                            label="Proposal Body & Program Details"
                            value={descriptionHtml}
                            onChange={setDescriptionHtml}
                            disabled={submitting}
                        />

                        {defaultDocType ? (
                            <div className="flex flex-col gap-2">
                                <span className="text-xs font-medium">
                                    Supporting Proposal File (Optional — Direct to Google Drive)
                                </span>
                                {drivePreviewPath ? (
                                    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/60 px-3 py-2">
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <FolderTree
                                                className="size-3.5"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            Google Drive Destination Path
                                        </span>
                                        <span className="break-all font-mono text-xs text-foreground">
                                            {drivePreviewPath}
                                        </span>
                                    </div>
                                ) : null}
                                <div
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragActive(true);
                                    }}
                                    onDragLeave={() => setDragActive(false)}
                                    onDrop={handleDrop}
                                    className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
                                        dragActive
                                            ? "border-primary bg-brand-soft/40"
                                            : "border-border bg-muted/40"
                                    }`}
                                >
                                    <UploadCloud
                                        className="size-7 text-muted-foreground"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    {selectedFile ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-foreground">
                                                {selectedFile.name} (
                                                <span className="font-mono text-xs">
                                                    {formatFileSizeBytes(selectedFile.size)}
                                                </span>
                                                )
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Remove selected file"
                                                onClick={() => setSelectedFile(null)}
                                            >
                                                <X
                                                    className="size-4"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            </Button>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            Drag and drop a proposal PDF/DOCX here, or browse from
                                            your device.
                                        </p>
                                    )}
                                    <p className="font-mono text-xs text-muted-foreground">
                                        {ACCEPTED_FILE_EXTENSIONS.join(", ")} &bull; Max{" "}
                                        {maxMbLabel} MB
                                    </p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept={ACCEPT_INPUT_ATTR}
                                        disabled={submitting}
                                        className="sr-only"
                                        aria-label="Attach proposal file"
                                        onChange={(e) =>
                                            handleFilePicked(e.target.files?.[0] ?? null)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        disabled={submitting}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {selectedFile ? "Replace File" : "Browse File"}
                                    </Button>
                                </div>
                            </div>
                        ) : null}

                        {requiresBreakGlass ? (
                            <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3">
                                <label
                                    htmlFor="proposal-bg-reason"
                                    className="flex items-center gap-1.5 text-xs font-medium text-warning"
                                >
                                    <ShieldAlert
                                        className="size-3.5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Super Admin Break-Glass Audit Reason (min 10 chars)
                                </label>
                                <Input
                                    id="proposal-bg-reason"
                                    required
                                    disabled={submitting}
                                    value={breakGlassReason}
                                    onChange={(e) => setBreakGlassReason(e.target.value)}
                                    placeholder="Explain why Super Admin without a term appointment is authoring this proposal..."
                                />
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                            {statusNote ? (
                                <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Loader2
                                        className="size-3.5 animate-spin"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    {statusNote}
                                </span>
                            ) : null}
                            <Button
                                type="submit"
                                variant="secondary"
                                disabled={
                                    submitting ||
                                    title.trim().length < 3 ||
                                    !descriptionHtml.trim() ||
                                    !startAt ||
                                    !endAt ||
                                    (requiresBreakGlass && breakGlassReason.trim().length < 10)
                                }
                            >
                                <Save className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                <span>Save as Draft</span>
                            </Button>
                            <Button
                                type="button"
                                disabled={
                                    submitting ||
                                    title.trim().length < 3 ||
                                    !descriptionHtml.trim() ||
                                    !startAt ||
                                    !endAt ||
                                    (requiresBreakGlass && breakGlassReason.trim().length < 10)
                                }
                                onClick={() => void submitProposal(true)}
                            >
                                <Send className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                <span>Submit for Review</span>
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
