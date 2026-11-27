"use client";

import { useState, type FormEvent } from "react";
import {
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    FileUp,
    FolderOpen,
    Link2,
    Loader2,
    RotateCcw,
    Search,
} from "lucide-react";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    DOCUMENT_STATUSES,
    DOCUMENT_STORAGE_MODES,
    DOCUMENTS_DEFAULT_LIMIT,
    formatFileSizeBytes,
    type ActiveDocumentTypeOption,
    type DocumentDto,
    type DocumentEventOption,
    type DocumentTermOption,
} from "@/lib/drive/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentDetailDrawer } from "./document-detail-drawer";
import { DocumentStatusBadge, StorageModeBadge } from "./document-status-badge";
import { DocumentUploadDialog } from "./document-upload-dialog";

interface DocumentsRegistryProps {
    userRole: SystemRole;
    initialItems: DocumentDto[];
    initialTotal: number;
    documentTypes: ActiveDocumentTypeOption[];
    terms: DocumentTermOption[];
    activeTerm: DocumentTermOption | null;
    events: DocumentEventOption[];
    driveShareMode: "domain" | "unlisted";
    maxUploadSizeBytes: number;
}

export function DocumentsRegistry({
    userRole,
    initialItems,
    initialTotal,
    documentTypes,
    terms,
    activeTerm,
    events,
    driveShareMode,
    maxUploadSizeBytes,
}: DocumentsRegistryProps) {
    const [items, setItems] = useState<DocumentDto[]>(initialItems);
    const [total, setTotal] = useState(initialTotal);
    const [page, setPage] = useState(1);

    const [q, setQ] = useState("");
    const [academicTermId, setAcademicTermId] = useState("");
    const [documentTypeId, setDocumentTypeId] = useState("");
    const [status, setStatus] = useState("");
    const [storageMode, setStorageMode] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [uploadDialogMode, setUploadDialogMode] = useState<"upload" | "external" | null>(null);
    const [selectedDoc, setSelectedDoc] = useState<DocumentDto | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / DOCUMENTS_DEFAULT_LIMIT));
    const hasActiveFilters = Boolean(
        q.trim() || academicTermId || documentTypeId || status || storageMode || fromDate || toDate,
    );

    function buildParams(targetPage: number) {
        const params = new URLSearchParams({
            page: String(targetPage),
            limit: String(DOCUMENTS_DEFAULT_LIMIT),
        });
        if (q.trim()) params.set("q", q.trim());
        if (academicTermId) params.set("academicTermId", academicTermId);
        if (documentTypeId) params.set("documentTypeId", documentTypeId);
        if (status) params.set("status", status);
        if (storageMode) params.set("storageMode", storageMode);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        return params;
    }

    async function fetchDocuments(targetPage: number, reset = false) {
        setLoading(true);
        setErrorMsg(null);
        try {
            const params = reset
                ? new URLSearchParams({
                      page: "1",
                      limit: String(DOCUMENTS_DEFAULT_LIMIT),
                  })
                : buildParams(targetPage);

            const res = await fetch(`${ROUTES.api.documents}?${params.toString()}`);
            const payload = (await res.json()) as {
                data?: {
                    items: DocumentDto[];
                    pagination: { page: number; total: number };
                };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to load documents.");
                return;
            }
            setItems(payload.data.items);
            setTotal(payload.data.pagination.total);
            setPage(payload.data.pagination.page);
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
        void fetchDocuments(1);
    }

    function handleResetFilters() {
        setQ("");
        setAcademicTermId("");
        setDocumentTypeId("");
        setStatus("");
        setStorageMode("");
        setFromDate("");
        setToDate("");
        void fetchDocuments(1, true);
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                    Showing <span className="font-mono text-foreground">{total}</span>{" "}
                    {total === 1 ? "document" : "documents"}
                    {activeTerm ? (
                        <>
                            {" "}
                            &bull; Active Term:{" "}
                            <span className="font-mono text-foreground">{activeTerm.code}</span>
                        </>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setUploadDialogMode("external")}
                    >
                        <Link2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        <span>Link Drive URL</span>
                    </Button>
                    <Button type="button" onClick={() => setUploadDialogMode("upload")}>
                        <FileUp className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        <span>Upload Document</span>
                    </Button>
                </div>
            </div>

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

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <form
                    onSubmit={handleFilterSubmit}
                    className="grid gap-3 border-b border-border bg-muted/40 p-4 md:grid-cols-6"
                >
                    <div className="relative md:col-span-2">
                        <Search
                            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        <Input
                            aria-label="Search documents"
                            placeholder="Search title, filename, event..."
                            className="pl-9"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <select
                        aria-label="Filter by document type"
                        value={documentTypeId}
                        onChange={(e) => setDocumentTypeId(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Document Types</option>
                        {documentTypes.map((dt) => (
                            <option key={dt.id} value={dt.id}>
                                {dt.name}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by document status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Statuses</option>
                        {DOCUMENT_STATUSES.map((st) => (
                            <option key={st} value={st}>
                                {st === "FOR_REVIEW" ? "FOR REVIEW" : st}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by academic term"
                        value={academicTermId}
                        onChange={(e) => setAcademicTermId(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Terms</option>
                        {terms.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.code}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter by storage mode"
                        value={storageMode}
                        onChange={(e) => setStorageMode(e.target.value)}
                        className="min-h-11 rounded-md border border-border bg-card px-3 text-sm sm:min-h-10"
                    >
                        <option value="">All Sources</option>
                        {DOCUMENT_STORAGE_MODES.map((m) => (
                            <option key={m} value={m}>
                                {m === "DRIVE_UPLOAD" ? "Drive Upload" : "External Link"}
                            </option>
                        ))}
                    </select>

                    <div className="flex items-center gap-2 md:col-span-2">
                        <Input
                            aria-label="From date (PHT)"
                            type="date"
                            className="font-mono text-xs"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                        />
                        <Input
                            aria-label="To date (PHT)"
                            type="date"
                            className="font-mono text-xs"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-4">
                        {hasActiveFilters ? (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={loading}
                                onClick={handleResetFilters}
                            >
                                <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                <span>Reset</span>
                            </Button>
                        ) : null}
                        <Button type="submit" variant="secondary" disabled={loading}>
                            {loading ? (
                                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                                <Search className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            )}
                            <span>Apply Filters</span>
                        </Button>
                    </div>
                </form>

                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                        <FolderOpen
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            {hasActiveFilters
                                ? "No documents match the current filters."
                                : "No documents have been archived in this workspace yet."}
                        </p>
                        {!hasActiveFilters ? (
                            <Button
                                type="button"
                                size="sm"
                                className="mt-1"
                                onClick={() => setUploadDialogMode("upload")}
                            >
                                <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Upload Document</span>
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                                    <th className="px-4 py-3">Document</th>
                                    <th className="px-4 py-3">Category &amp; Scope</th>
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
                                            <div className="font-medium text-foreground">{doc.title}</div>
                                            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                                                {doc.originalFilename ?? doc.drivePathDisplay}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="text-sm text-foreground">
                                                {doc.documentType.name}
                                            </div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                {doc.event
                                                    ? `Event: ${doc.event.title}`
                                                    : doc.meeting
                                                      ? `Meeting: ${doc.meeting.title}`
                                                      : "General"}
                                            </div>
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
                                        <td className="px-4 py-3">
                                            <div className="text-xs text-foreground">
                                                {doc.uploadedBy?.fullName ?? "Unknown"}
                                            </div>
                                            <div className="font-mono text-xs text-muted-foreground">
                                                {formatManilaTimestamp(doc.createdAt)}
                                            </div>
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

                {total > DOCUMENTS_DEFAULT_LIMIT ? (
                    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                        <span>
                            Page <span className="font-mono text-foreground">{page}</span> of{" "}
                            <span className="font-mono text-foreground">{totalPages}</span>
                        </span>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={loading || page <= 1}
                                onClick={() => void fetchDocuments(page - 1)}
                            >
                                <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Previous</span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={loading || page >= totalPages}
                                onClick={() => void fetchDocuments(page + 1)}
                            >
                                <span>Next</span>
                                <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            <DocumentUploadDialog
                open={uploadDialogMode !== null}
                initialMode={uploadDialogMode ?? "upload"}
                userRole={userRole}
                documentTypes={documentTypes}
                activeTerm={activeTerm}
                events={events}
                maxUploadSizeBytes={maxUploadSizeBytes}
                onClose={() => setUploadDialogMode(null)}
                onSuccess={() => {
                    setUploadDialogMode(null);
                    void fetchDocuments(1);
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
