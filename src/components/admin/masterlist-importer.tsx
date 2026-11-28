"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    Loader2,
    Upload,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface ImportHistoryDto {
    id: string;
    termCode: string;
    uploadedByName: string;
    sourceFilename: string;
    totalRows: number;
    createdCount: number;
    skippedExistingCount: number;
    flaggedReviewCount: number;
    createdAt: string;
}

interface PreviewResponse {
    activeTerm: { id: string; code: string };
    preview: {
        sourceFilename: string;
        totalRows: number;
        hasBlockingErrors: boolean;
        toCreate: Array<{
            rowNumber: number;
            studentIdNumber: string;
            fullName: string;
        }>;
        existingActive: Array<{
            rowNumber: number;
            studentIdNumber: string;
            fullName: string;
            systemRole: string;
        }>;
        warnings: Array<{
            rowNumber: number | null;
            studentIdNumber: string;
            fullName: string;
            code: string;
            blocking: boolean;
            message: string;
        }>;
        missingFromMasterlist: Array<{
            userId: string;
            studentIdNumber: string;
            fullName: string;
        }>;
    };
    parsedRows: unknown[];
}

interface MasterlistImporterProps {
    isSuperAdmin: boolean;
    activeTermCode: string | null;
    initialHistory: ImportHistoryDto[];
}

export function MasterlistImporter({
    isSuperAdmin,
    activeTermCode,
    initialHistory,
}: MasterlistImporterProps) {
    const router = useRouter();
    const [history, setHistory] = useState<ImportHistoryDto[]>(initialHistory);
    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
    const [activeTab, setActiveTab] = useState<"create" | "existing" | "warnings">("create");
    const [flagMissing, setFlagMissing] = useState(true);
    const [previewing, setPreviewing] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    async function handlePreview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!file) {
            setErrorMsg("Select a .csv or .xlsx file first.");
            return;
        }
        setErrorMsg(null);
        setPreviewing(true);

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`${ROUTES.api.adminMasterlist}/preview`, {
                method: "POST",
                body: formData,
            });
            const payload = (await res.json()) as {
                data?: PreviewResponse;
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to parse masterlist file.");
                return;
            }
            setPreviewData(payload.data);
            setActiveTab(payload.data.preview.warnings.length > 0 ? "warnings" : "create");
            toast.success(`Preview ready (${payload.data.preview.totalRows} rows parsed).`);
        } finally {
            setPreviewing(false);
        }
    }

    async function handleCommit() {
        if (!previewData) return;
        setErrorMsg(null);
        setCommitting(true);

        try {
            const res = await fetch(`${ROUTES.api.adminMasterlist}/commit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sourceFilename: previewData.preview.sourceFilename,
                    rows: previewData.parsedRows,
                    flagMissingAsNeedsReview: flagMissing,
                }),
            });
            const payload = (await res.json()) as {
                data?: {
                    importRecord: {
                        createdCount: number;
                        skippedExistingCount: number;
                        flaggedReviewCount: number;
                    };
                };
                error?: { message?: string };
            };
            if (!res.ok) {
                setErrorMsg(payload.error?.message ?? "Masterlist commit failed.");
                return;
            }

            const stats = payload.data?.importRecord;
            toast.success(
                `Masterlist committed: ${stats?.createdCount ?? 0} created, ${stats?.skippedExistingCount ?? 0} skipped, ${stats?.flaggedReviewCount ?? 0} flagged.`,
            );
            setPreviewData(null);
            setFile(null);

            const listRes = await fetch(ROUTES.api.adminMasterlist);
            if (listRes.ok) {
                const listPayload = (await listRes.json()) as {
                    data: { imports: ImportHistoryDto[] };
                };
                setHistory(listPayload.data.imports);
            }
            router.refresh();
        } finally {
            setCommitting(false);
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

            {isSuperAdmin ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Upload Semester Masterlist</CardTitle>
                        <CardDescription>
                            Supports <span className="font-mono">.csv</span> and{" "}
                            <span className="font-mono">.xlsx</span> up to{" "}
                            <span className="font-mono">5 MB</span> /{" "}
                            <span className="font-mono">2,000</span> rows. Target active term:{" "}
                            <span className="font-mono text-foreground">
                                {activeTermCode ?? "None (Activate a term first)"}
                            </span>
                            .
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                        <form onSubmit={handlePreview} className="flex flex-wrap items-center gap-3">
                            <input
                                aria-label="Masterlist CSV or XLSX file"
                                type="file"
                                accept=".csv,.xlsx"
                                onChange={(e) => {
                                    setFile(e.target.files?.[0] ?? null);
                                    setPreviewData(null);
                                }}
                                className="min-h-11 max-w-full flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-card file:px-3 file:py-1 file:text-xs file:font-medium sm:min-h-10"
                            />
                            <Button
                                type="submit"
                                disabled={previewing || !file || !activeTermCode}
                            >
                                {previewing ? (
                                    <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                                ) : (
                                    <Upload className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                )}
                                <span>{previewing ? "Parsing..." : "Preview import"}</span>
                            </Button>
                        </form>

                        {previewData ? (
                            <div className="flex flex-col gap-4 border-t border-border pt-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("create")}
                                            className={`min-h-11 rounded-md border px-3 text-xs font-medium transition-colors sm:min-h-10 ${
                                                activeTab === "create"
                                                    ? "border-primary bg-brand-soft text-primary dark:text-brand-accent"
                                                    : "border-border bg-muted text-muted-foreground"
                                            }`}
                                        >
                                            New to Create ({previewData.preview.toCreate.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("existing")}
                                            className={`min-h-11 rounded-md border px-3 text-xs font-medium transition-colors sm:min-h-10 ${
                                                activeTab === "existing"
                                                    ? "border-primary bg-brand-soft text-primary dark:text-brand-accent"
                                                    : "border-border bg-muted text-muted-foreground"
                                            }`}
                                        >
                                            Existing Active ({previewData.preview.existingActive.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab("warnings")}
                                            className={`min-h-11 rounded-md border px-3 text-xs font-medium transition-colors sm:min-h-10 ${
                                                activeTab === "warnings"
                                                    ? "border-primary bg-brand-soft text-primary dark:text-brand-accent"
                                                    : "border-border bg-muted text-muted-foreground"
                                            }`}
                                        >
                                            Warnings &amp; Missing (
                                            {previewData.preview.warnings.length +
                                                previewData.preview.missingFromMasterlist.length}
                                            )
                                        </button>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="flex min-h-11 items-center gap-2 text-xs font-medium sm:min-h-10">
                                            <input
                                                type="checkbox"
                                                checked={flagMissing}
                                                onChange={(e) => setFlagMissing(e.target.checked)}
                                                className="size-4 accent-primary"
                                            />
                                            <span>
                                                Flag {previewData.preview.missingFromMasterlist.length}{" "}
                                                missing members as NEEDS_REVIEW
                                            </span>
                                        </label>
                                        <Button
                                            onClick={handleCommit}
                                            disabled={
                                                committing || previewData.preview.hasBlockingErrors
                                            }
                                        >
                                            {committing ? (
                                                <Loader2
                                                    className="size-4 animate-spin"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            ) : (
                                                <CheckCircle2
                                                    className="size-4"
                                                    strokeWidth={1.75}
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <span>
                                                {committing ? "Committing..." : "Commit Import"}
                                            </span>
                                        </Button>
                                    </div>
                                </div>

                                {previewData.preview.hasBlockingErrors ? (
                                    <div
                                        role="alert"
                                        className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
                                    >
                                        <AlertTriangle className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                        <span>
                                            Blocking duplicate, malformed, or formula-prefixed rows
                                            must be fixed in the source file before committing.
                                        </span>
                                    </div>
                                ) : null}

                                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                                    {activeTab === "create" ? (
                                        <table className="w-full text-left text-sm">
                                            <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-2.5">Row</th>
                                                    <th className="px-4 py-2.5">Student ID</th>
                                                    <th className="px-4 py-2.5">Full Name</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {previewData.preview.toCreate.map((r) => (
                                                    <tr key={`${r.rowNumber}-${r.studentIdNumber}`}>
                                                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                                                            {r.rowNumber}
                                                        </td>
                                                        <td className="px-4 py-2 font-mono text-xs">
                                                            {r.studentIdNumber}
                                                        </td>
                                                        <td className="px-4 py-2">{r.fullName}</td>
                                                    </tr>
                                                ))}
                                                {previewData.preview.toCreate.length === 0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={3}
                                                            className="px-4 py-6 text-center text-muted-foreground"
                                                        >
                                                            No new accounts to provision.
                                                        </td>
                                                    </tr>
                                                ) : null}
                                            </tbody>
                                        </table>
                                    ) : activeTab === "existing" ? (
                                        <table className="w-full text-left text-sm">
                                            <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-2.5">Student ID</th>
                                                    <th className="px-4 py-2.5">Full Name</th>
                                                    <th className="px-4 py-2.5">Role</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {previewData.preview.existingActive.map((r) => (
                                                    <tr key={r.studentIdNumber}>
                                                        <td className="px-4 py-2 font-mono text-xs">
                                                            {r.studentIdNumber}
                                                        </td>
                                                        <td className="px-4 py-2">{r.fullName}</td>
                                                        <td className="px-4 py-2">
                                                            <Badge variant="neutral">{r.systemRole}</Badge>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {previewData.preview.existingActive.length === 0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={3}
                                                            className="px-4 py-6 text-center text-muted-foreground"
                                                        >
                                                            No existing active accounts matched.
                                                        </td>
                                                    </tr>
                                                ) : null}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <table className="w-full text-left text-sm">
                                            <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-2.5">Student ID</th>
                                                    <th className="px-4 py-2.5">Name</th>
                                                    <th className="px-4 py-2.5">Issue</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {previewData.preview.warnings.map((w, idx) => (
                                                    <tr key={`w-${idx}-${w.studentIdNumber}`}>
                                                        <td className="px-4 py-2 font-mono text-xs">
                                                            {w.studentIdNumber}
                                                        </td>
                                                        <td className="px-4 py-2">{w.fullName}</td>
                                                        <td className="px-4 py-2 text-xs">
                                                            <Badge
                                                                variant={
                                                                    w.blocking
                                                                        ? "destructive"
                                                                        : "warning"
                                                                }
                                                            >
                                                                {w.code}
                                                            </Badge>{" "}
                                                            <span className="ml-1 text-muted-foreground">
                                                                {w.message}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {previewData.preview.missingFromMasterlist.map((m) => (
                                                    <tr key={`m-${m.userId}`}>
                                                        <td className="px-4 py-2 font-mono text-xs">
                                                            {m.studentIdNumber}
                                                        </td>
                                                        <td className="px-4 py-2">{m.fullName}</td>
                                                        <td className="px-4 py-2 text-xs">
                                                            <Badge variant="warning">
                                                                MISSING_FROM_MASTERLIST
                                                            </Badge>{" "}
                                                            <span className="ml-1 text-muted-foreground">
                                                                Absent from upload; will be flagged
                                                                NEEDS_REVIEW.
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {previewData.preview.warnings.length === 0 &&
                                                previewData.preview.missingFromMasterlist.length ===
                                                    0 ? (
                                                    <tr>
                                                        <td
                                                            colSpan={3}
                                                            className="px-4 py-6 text-center text-muted-foreground"
                                                        >
                                                            Zero warnings or missing accounts.
                                                        </td>
                                                    </tr>
                                                ) : null}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                        <span>Masterlist Import History</span>
                    </CardTitle>
                    <CardDescription>
                        Append-only log of semester imports and formula-safe discrepancy reports.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto border-t border-border">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3">Date (UTC)</th>
                                    <th className="px-4 py-3">Term</th>
                                    <th className="px-4 py-3">Filename</th>
                                    <th className="px-4 py-3">Created</th>
                                    <th className="px-4 py-3">Skipped</th>
                                    <th className="px-4 py-3">Flagged</th>
                                    <th className="px-4 py-3 text-right">Report</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {history.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-4 py-8 text-center text-muted-foreground"
                                        >
                                            No masterlist imports recorded yet.
                                        </td>
                                    </tr>
                                ) : (
                                    history.map((item) => (
                                        <tr key={item.id}>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                {item.createdAt.slice(0, 16).replace("T", " ")}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {item.termCode}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {item.sourceFilename}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {item.createdCount}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {item.skippedExistingCount}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {item.flaggedReviewCount}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <a
                                                    href={`${ROUTES.api.adminMasterlist}/${item.id}/report`}
                                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 sm:min-h-9"
                                                >
                                                    <Download
                                                        className="size-3.5"
                                                        strokeWidth={1.75}
                                                        aria-hidden="true"
                                                    />
                                                    <span>CSV</span>
                                                </a>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
