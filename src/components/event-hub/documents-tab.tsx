"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileUp, FolderOpen, Link2, Lock } from "lucide-react";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    DOCUMENTS_DEFAULT_LIMIT,
    formatFileSizeBytes,
    type ActiveDocumentTypeOption,
    type DocumentDto,
    type DocumentEventOption,
    type DocumentTermOption,
} from "@/lib/drive/validation";
import { DocumentDetailDrawer } from "@/app/(workspace)/documents/_components/document-detail-drawer";
import {
    DocumentStatusBadge,
    StorageModeBadge,
} from "@/app/(workspace)/documents/_components/document-status-badge";
import { DocumentUploadDialog } from "@/app/(workspace)/documents/_components/document-upload-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface EventDocumentsTabProps {
    eventId: string;
    eventStatus: string;
    userRole: SystemRole;
}

export function EventDocumentsTab({
    eventId,
    eventStatus,
    userRole,
}: EventDocumentsTabProps) {
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [items, setItems] = useState<DocumentDto[]>([]);
    const [documentTypes, setDocumentTypes] = useState<ActiveDocumentTypeOption[]>([]);
    const [activeTerm, setActiveTerm] = useState<DocumentTermOption | null>(null);
    const [eventMeta, setEventMeta] = useState<DocumentEventOption | null>(null);
    const [driveShareMode, setDriveShareMode] = useState<"domain" | "unlisted">("domain");
    const [maxUploadSizeBytes, setMaxUploadSizeBytes] = useState(15_728_640);

    const [uploadDialogMode, setUploadDialogMode] = useState<"upload" | "external" | null>(null);
    const [selectedDoc, setSelectedDoc] = useState<DocumentDto | null>(null);

    const loadEventDocuments = useCallback(async () => {
        setErrorMsg(null);
        try {
            const params = new URLSearchParams({
                eventId,
                includeMeta: "true",
                page: "1",
                limit: String(DOCUMENTS_DEFAULT_LIMIT),
            });
            const res = await fetch(`${ROUTES.api.documents}?${params.toString()}`);
            const payload = (await res.json()) as {
                data?: {
                    items: DocumentDto[];
                    meta?: {
                        documentTypes: ActiveDocumentTypeOption[];
                        activeTerm: DocumentTermOption | null;
                        eventMeta: DocumentEventOption | null;
                        driveShareMode: "domain" | "unlisted";
                        maxUploadSizeBytes: number;
                    };
                };
                error?: { message?: string };
            };

            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to load event documents.");
                return;
            }

            setItems(payload.data.items);
            if (payload.data.meta) {
                setDocumentTypes(payload.data.meta.documentTypes);
                setActiveTerm(payload.data.meta.activeTerm);
                setEventMeta(payload.data.meta.eventMeta);
                setDriveShareMode(payload.data.meta.driveShareMode);
                setMaxUploadSizeBytes(payload.data.meta.maxUploadSizeBytes);
            }
        } catch {
            setErrorMsg("Network error while loading event documents.");
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    useEffect(() => {
        let cancelled = false;
        async function loadInitial() {
            try {
                const params = new URLSearchParams({
                    eventId,
                    includeMeta: "true",
                    page: "1",
                    limit: String(DOCUMENTS_DEFAULT_LIMIT),
                });
                const res = await fetch(`${ROUTES.api.documents}?${params.toString()}`);
                const payload = (await res.json()) as {
                    data?: {
                        items: DocumentDto[];
                        meta?: {
                            documentTypes: ActiveDocumentTypeOption[];
                            activeTerm: DocumentTermOption | null;
                            eventMeta: DocumentEventOption | null;
                            driveShareMode: "domain" | "unlisted";
                            maxUploadSizeBytes: number;
                        };
                    };
                    error?: { message?: string };
                };
                if (cancelled) return;

                if (!res.ok || !payload.data) {
                    setErrorMsg(payload.error?.message ?? "Failed to load event documents.");
                } else {
                    setItems(payload.data.items);
                    if (payload.data.meta) {
                        setDocumentTypes(payload.data.meta.documentTypes);
                        setActiveTerm(payload.data.meta.activeTerm);
                        setEventMeta(payload.data.meta.eventMeta);
                        setDriveShareMode(payload.data.meta.driveShareMode);
                        setMaxUploadSizeBytes(payload.data.meta.maxUploadSizeBytes);
                    }
                }
            } catch {
                if (!cancelled) {
                    setErrorMsg("Network error while loading event documents.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        void loadInitial();
        return () => {
            cancelled = true;
        };
    }, [eventId]);

    if (loading) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-56 w-full" />
            </div>
        );
    }

    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isLocked =
        eventStatus === "COMPLETED" ||
        eventStatus === "REJECTED" ||
        eventMeta?.academicTermStatus === "CLOSED";
    const canUpload =
        (userRole === "OFFICER" || userRole === "EXECUTIVE" || userRole === "SUPER_ADMIN") &&
        (!isLocked || isSuperAdmin) &&
        Boolean(eventMeta);

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
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <div>
                        <CardTitle>Event Documents</CardTitle>
                        <CardDescription>
                            Files routed to this event&apos;s Google Drive folder &bull; Status:{" "}
                            <span className="font-mono text-xs text-foreground">{eventStatus}</span>
                        </CardDescription>
                    </div>
                    {canUpload ? (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => setUploadDialogMode("external")}
                            >
                                <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Link Drive URL</span>
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => setUploadDialogMode("upload")}
                            >
                                <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Upload Document</span>
                            </Button>
                        </div>
                    ) : null}
                </CardHeader>

                <CardContent className="p-0">
                    {isLocked && !isSuperAdmin ? (
                        <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
                            <Lock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                            <span>
                                Documents are read-only for finalized events or closed academic
                                terms. Only Super Admin break-glass overrides can attach new files.
                            </span>
                        </div>
                    ) : null}
                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 border-t border-border px-6 py-10 text-center">
                            <FolderOpen
                                className="size-10 text-muted-foreground"
                                strokeWidth={1.5}
                                aria-hidden="true"
                            />
                            <p className="text-sm text-muted-foreground">
                                No documents or proposal attachments are linked to this event yet.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border-t border-border">
                            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                                        <th className="px-4 py-3">Document</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Source</th>
                                        <th className="px-4 py-3">Uploaded (PHT)</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {items.map((doc) => (
                                        <tr key={doc.id} className="hover:bg-muted/30">
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-foreground">
                                                    {doc.title}
                                                </div>
                                                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                                    {doc.drivePathDisplay}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-foreground">
                                                {doc.documentType.name}
                                            </td>
                                            <td className="px-4 py-3">
                                                <DocumentStatusBadge status={doc.status} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col items-start gap-1">
                                                    <StorageModeBadge mode={doc.storageMode} />
                                                    <span className="font-mono text-xs text-muted-foreground">
                                                        {formatFileSizeBytes(doc.fileSizeBytes)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                {formatManilaTimestamp(doc.createdAt)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setSelectedDoc(doc)}
                                                >
                                                    Inspect
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <DocumentUploadDialog
                open={uploadDialogMode !== null}
                initialMode={uploadDialogMode ?? "upload"}
                userRole={userRole}
                documentTypes={documentTypes}
                activeTerm={activeTerm}
                lockedEvent={eventMeta}
                allowProposalToggle={
                    eventStatus === "DRAFT" || eventStatus === "NEEDS_REVISION"
                }
                maxUploadSizeBytes={maxUploadSizeBytes}
                onClose={() => setUploadDialogMode(null)}
                onSuccess={() => {
                    setUploadDialogMode(null);
                    void loadEventDocuments();
                }}
            />

            <DocumentDetailDrawer
                document={selectedDoc}
                userRole={userRole}
                driveShareMode={driveShareMode}
                onClose={() => setSelectedDoc(null)}
                onUpdated={(updated) => {
                    setSelectedDoc(updated);
                    setItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
                }}
            />
        </div>
    );
}
