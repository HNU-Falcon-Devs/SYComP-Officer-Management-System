"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    FileText,
    FolderTree,
    Info,
    Lock,
    RotateCcw,
    X,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    formatFileSizeBytes,
    getAvailableDocumentTransitions,
    isApprovalOrArchiveTransition,
    type DocumentDto,
    type DocumentStatus,
} from "@/lib/drive/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BreakGlassDialog } from "./break-glass-dialog";
import { DocumentStatusBadge, StorageModeBadge } from "./document-status-badge";

export interface DocumentDetailDrawerProps {
    document: DocumentDto | null;
    userRole: SystemRole;
    driveShareMode: "domain" | "unlisted";
    onClose: () => void;
    onUpdated: (document: DocumentDto) => void;
}

const TRANSITION_LABELS: Record<DocumentStatus, string> = {
    DRAFT: "Draft",
    FOR_REVIEW: "Send for Review",
    SUBMITTED: "Mark Submitted",
    APPROVED: "Approve Document",
    ARCHIVED: "Archive Document",
};

export function DocumentDetailDrawer({
    document,
    ...rest
}: DocumentDetailDrawerProps) {
    if (!document) {
        return null;
    }
    return <DocumentDetailDrawerBody key={document.id} document={document} {...rest} />;
}

function DocumentDetailDrawerBody({
    document,
    userRole,
    driveShareMode,
    onClose,
    onUpdated,
}: Omit<DocumentDetailDrawerProps, "document"> & { document: DocumentDto }) {
    const [titleDraft, setTitleDraft] = useState(document.title);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [pendingBreakGlass, setPendingBreakGlass] = useState<{
        actionLabel: string;
        payload: { title?: string; status?: DocumentStatus };
    } | null>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !saving && !pendingBreakGlass) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose, pendingBreakGlass, saving]);

    const canApprove = userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN";
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isTermOrParentLocked = Boolean(
        document.academicTerm.status === "CLOSED" ||
            document.event?.status === "COMPLETED" ||
            document.event?.status === "REJECTED" ||
            document.meeting?.status === "COMPLETED" ||
            document.meeting?.status === "CANCELLED",
    );
    const canMutate = !isTermOrParentLocked || isSuperAdmin;
    const availableTransitions = canMutate
        ? getAvailableDocumentTransitions(document.status, canApprove)
        : [];
    const canRename =
        canMutate &&
        document.status !== "ARCHIVED" &&
        (document.status !== "APPROVED" || canApprove);

    async function patchDocument(
        payload: { title?: string; status?: DocumentStatus },
        breakGlassReason?: string,
    ) {
        if (!document) return;
        setSaving(true);
        setErrorMsg(null);
        try {
            const res = await fetch(`${ROUTES.api.documents}/${document.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...payload,
                    ...(breakGlassReason
                        ? { breakGlass: true, reason: breakGlassReason }
                        : {}),
                }),
            });
            const body = (await res.json()) as {
                data?: { document: DocumentDto };
                error?: { message?: string };
            };
            if (!res.ok || !body.data?.document) {
                setErrorMsg(body.error?.message ?? "Failed to update document.");
                return;
            }
            toast.success("Document updated.");
            setPendingBreakGlass(null);
            onUpdated(body.data.document);
        } catch {
            setErrorMsg("Network error while updating document. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    function requestUpdate(
        actionLabel: string,
        payload: { title?: string; status?: DocumentStatus },
    ) {
        if (!document) return;
        const requiresBreakGlass =
            isSuperAdmin &&
            (isTermOrParentLocked ||
                document.status === "APPROVED" ||
                (payload.status !== undefined &&
                    isApprovalOrArchiveTransition(document.status, payload.status)));

        if (requiresBreakGlass) {
            setPendingBreakGlass({ actionLabel, payload });
            return;
        }
        void patchDocument(payload);
    }

    function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!document) return;
        const trimmed = titleDraft.trim();
        if (trimmed.length < 2 || trimmed === document.title) {
            return;
        }
        requestUpdate("DOCUMENT_RENAMED", { title: trimmed });
    }

    return (
        <>
            <div
                className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/30 p-0 md:items-center md:p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="doc-detail-title"
            >
                <div
                    className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[14px] border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[14px] md:pb-5"
                    style={{ boxShadow: "var(--shadow-overlay-md)" }}
                >
                    <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <DocumentStatusBadge status={document.status} />
                                <StorageModeBadge mode={document.storageMode} />
                                {document.isProposalAttachment ? (
                                    <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                                        Proposal Attachment
                                    </span>
                                ) : null}
                            </div>
                            <h2 id="doc-detail-title" className="mt-2 text-lg font-semibold">
                                {document.title}
                            </h2>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={saving}
                            aria-label="Close document details"
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

                    <div className="mt-4 flex flex-col gap-4">
                        <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-xs sm:grid-cols-2">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">Document Type</span>
                                <span className="font-medium text-foreground">
                                    {document.documentType.name}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">Academic Term</span>
                                <span className="font-mono text-foreground">
                                    {document.academicTerm.code} ({document.academicTerm.status})
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">Linked Context</span>
                                <span className="font-medium text-foreground">
                                    {document.event
                                        ? `Event: ${document.event.title}`
                                        : document.meeting
                                          ? `Meeting: ${document.meeting.title}`
                                          : "General Organizational Document"}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">File Size &amp; MIME</span>
                                <span className="font-mono text-foreground">
                                    {formatFileSizeBytes(document.fileSizeBytes)}
                                    {document.mimeType ? ` · ${document.mimeType}` : ""}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5 sm:col-span-2">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <FolderTree className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    Google Drive Folder Path
                                </span>
                                <span className="break-all font-mono text-foreground">
                                    {document.drivePathDisplay}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">Uploaded By</span>
                                <span className="text-foreground">
                                    {document.uploadedBy
                                        ? `${document.uploadedBy.fullName} (${document.uploadedBy.studentIdNumber})`
                                        : "Unknown"}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                    {formatManilaTimestamp(document.createdAt)}
                                </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">Approval Record</span>
                                {document.approvedBy && document.approvedAt ? (
                                    <>
                                        <span className="text-foreground">
                                            {document.approvedBy.fullName} (
                                            {document.approvedBy.studentIdNumber})
                                        </span>
                                        <span className="font-mono text-muted-foreground">
                                            {formatManilaTimestamp(document.approvedAt)}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-muted-foreground">Not yet approved</span>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                            <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                <span>
                                    {driveShareMode === "domain"
                                        ? "Requires signing in with your official university Google account."
                                        : "Shared as an unlisted Google Drive file accessible via direct link."}
                                </span>
                            </div>
                            <a
                                href={document.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-9"
                            >
                                <span>Open in Google Drive</span>
                                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </a>
                        </div>

                        {document.previewEmbedUrl ? (
                            <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                                <iframe
                                    src={document.previewEmbedUrl}
                                    title={`Preview of ${document.title}`}
                                    className="h-72 w-full border-0"
                                    sandbox="allow-scripts allow-same-origin allow-popups"
                                />
                            </div>
                        ) : (
                            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
                                <FileText className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                <span>
                                    {document.driveFileId?.startsWith("mock-file-")
                                        ? "Local mock Drive preview unavailable; configure live Google Drive OAuth credentials for embedded file previews."
                                        : "Embedded preview is unavailable for this link. Use Open in Google Drive above."}
                                </span>
                            </div>
                        )}

                        {isTermOrParentLocked && !isSuperAdmin ? (
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
                                <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                <span>
                                    Read-only: this document belongs to a closed term or finalized
                                    event/meeting.
                                </span>
                            </div>
                        ) : null}

                        {canRename ? (
                            <form
                                onSubmit={handleRenameSubmit}
                                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-end"
                            >
                                <div className="flex flex-1 flex-col gap-1">
                                    <label htmlFor="doc-rename-input" className="text-xs font-medium">
                                        Document Title
                                    </label>
                                    <Input
                                        id="doc-rename-input"
                                        disabled={saving}
                                        value={titleDraft}
                                        onChange={(e) => setTitleDraft(e.target.value)}
                                        maxLength={200}
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    variant="secondary"
                                    disabled={
                                        saving ||
                                        titleDraft.trim().length < 2 ||
                                        titleDraft.trim() === document.title
                                    }
                                >
                                    Save Title
                                </Button>
                            </form>
                        ) : null}

                        {availableTransitions.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                                <span className="mr-auto text-xs font-medium text-muted-foreground">
                                    Workflow Transitions
                                </span>
                                {availableTransitions.map((nextStatus) => {
                                    const label =
                                        document.status === "SUBMITTED" &&
                                        nextStatus === "FOR_REVIEW"
                                            ? "Return for Revision"
                                            : TRANSITION_LABELS[nextStatus];
                                    const variant =
                                        nextStatus === "APPROVED"
                                            ? "primary"
                                            : nextStatus === "ARCHIVED"
                                              ? "destructive"
                                              : "secondary";

                                    return (
                                        <Button
                                            key={nextStatus}
                                            type="button"
                                            size="sm"
                                            variant={variant}
                                            disabled={saving}
                                            onClick={() =>
                                                requestUpdate(
                                                    nextStatus === "APPROVED"
                                                        ? "DOCUMENT_APPROVED"
                                                        : nextStatus === "ARCHIVED"
                                                          ? "DOCUMENT_ARCHIVED"
                                                          : "DOCUMENT_STATUS_UPDATED",
                                                    { status: nextStatus },
                                                )
                                            }
                                        >
                                            {nextStatus === "APPROVED" ? (
                                                <CheckCircle2
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            ) : document.status === "SUBMITTED" &&
                                              nextStatus === "FOR_REVIEW" ? (
                                                <RotateCcw
                                                    className="size-3.5"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            ) : null}
                                            <span>{label}</span>
                                        </Button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <BreakGlassDialog
                open={Boolean(pendingBreakGlass)}
                actionLabel={pendingBreakGlass?.actionLabel ?? ""}
                targetLabel={document.title}
                submitting={saving}
                onCancel={() => setPendingBreakGlass(null)}
                onConfirm={(reason) => {
                    if (!pendingBreakGlass) return;
                    return patchDocument(pendingBreakGlass.payload, reason);
                }}
            />
        </>
    );
}
