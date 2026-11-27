"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    AlertTriangle,
    Archive,
    CheckCircle2,
    FolderOpen,
    FolderPlus,
    Loader2,
    Pencil,
    RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import {
    formatDrivePathPreview,
    slugifyDocumentTypeName,
    type DocumentTypeDto,
    type SystemSettingsSummary,
} from "@/lib/admin/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ActiveTermSummary {
    id: string;
    code: string;
    name: string;
}

interface SystemSettingsPanelData extends SystemSettingsSummary {
    cachedDriveFoldersCount: number;
}

interface SettingsManagerProps {
    isSuperAdmin: boolean;
    activeTerm: ActiveTermSummary | null;
    initialDocumentTypes: DocumentTypeDto[];
    systemSettings: SystemSettingsPanelData | null;
}

function ReadinessBadge({ configured }: { configured: boolean }) {
    if (configured) {
        return (
            <Badge variant="success">
                <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Configured
            </Badge>
        );
    }
    return (
        <Badge variant="warning">
            <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Not Configured
        </Badge>
    );
}

export function SettingsManager({
    isSuperAdmin,
    activeTerm,
    initialDocumentTypes,
    systemSettings,
}: SettingsManagerProps) {
    const router = useRouter();
    const [docTypes, setDocTypes] = useState<DocumentTypeDto[]>(initialDocumentTypes);

    // Create form state
    const [createName, setCreateName] = useState("");
    const [createSlug, setCreateSlug] = useState("");
    const [slugEditedManually, setSlugEditedManually] = useState(false);
    const [createSegment, setCreateSegment] = useState("");
    const [segmentEditedManually, setSegmentEditedManually] = useState(false);
    const [creating, setCreating] = useState(false);

    // Edit panel state
    const [editing, setEditing] = useState<DocumentTypeDto | null>(null);
    const [editName, setEditName] = useState("");
    const [editSegment, setEditSegment] = useState("");
    const [editReason, setEditReason] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const activeTermName = activeTerm?.name ?? null;

    async function refreshDocumentTypes() {
        const res = await fetch(`${ROUTES.api.adminDocumentTypes}?includeInactive=true`);
        if (res.ok) {
            const payload = (await res.json()) as { data?: { documentTypes: DocumentTypeDto[] } };
            if (payload.data) {
                setDocTypes(payload.data.documentTypes);
            }
        }
        router.refresh();
    }

    function handleCreateNameChange(value: string) {
        setCreateName(value);
        if (!slugEditedManually) {
            setCreateSlug(slugifyDocumentTypeName(value));
        }
        if (!segmentEditedManually) {
            setCreateSegment(value.trim());
        }
    }

    async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMsg(null);
        setCreating(true);

        try {
            const res = await fetch(ROUTES.api.adminDocumentTypes, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: createName,
                    slug: createSlug || undefined,
                    driveFolderSegment: createSegment,
                }),
            });
            const payload = (await res.json()) as {
                data?: { documentType: DocumentTypeDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to create document type.");
                return;
            }
            toast.success(`Document type "${payload.data.documentType.name}" created.`);
            setCreateName("");
            setCreateSlug("");
            setCreateSegment("");
            setSlugEditedManually(false);
            setSegmentEditedManually(false);
            await refreshDocumentTypes();
        } finally {
            setCreating(false);
        }
    }

    function startEditing(item: DocumentTypeDto) {
        setErrorMsg(null);
        setEditing(item);
        setEditName(item.name);
        setEditSegment(item.driveFolderSegment);
        setEditReason("");
    }

    async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!editing) return;
        setErrorMsg(null);
        setSavingEdit(true);

        try {
            const res = await fetch(`${ROUTES.api.adminDocumentTypes}/${editing.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: editName,
                    driveFolderSegment: editSegment,
                    ...(editReason.trim() ? { reason: editReason.trim() } : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { documentType: DocumentTypeDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to update document type.");
                return;
            }
            toast.success(`Updated "${payload.data.documentType.name}".`);
            setEditing(null);
            setEditReason("");
            await refreshDocumentTypes();
        } finally {
            setSavingEdit(false);
        }
    }

    async function handleToggleActive(item: DocumentTypeDto) {
        setErrorMsg(null);
        setTogglingId(item.id);
        const nextActive = !item.isActive;

        try {
            const res = await fetch(`${ROUTES.api.adminDocumentTypes}/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: nextActive }),
            });
            const payload = (await res.json()) as {
                data?: { documentType: DocumentTypeDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to update document type status.");
                return;
            }
            toast.success(
                nextActive
                    ? `Reactivated "${item.name}".`
                    : `Soft-disabled "${item.name}". Historical documents remain preserved.`,
            );
            await refreshDocumentTypes();
        } finally {
            setTogglingId(null);
        }
    }

    const createPreviewPath = formatDrivePathPreview(activeTermName, createSegment);
    const editPreviewPath = formatDrivePathPreview(activeTermName, editSegment);

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
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Dynamic Document Types</CardTitle>
                        <CardDescription>
                            Categories routed into Google Drive by{" "}
                            <span className="font-mono text-xs text-foreground">
                                resolveDriveFolderPath
                            </span>
                            . Slugs stay immutable to preserve existing folder cache keys.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto border-t border-border">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3">Name &amp; Slug</th>
                                        <th className="px-4 py-3">Drive Folder Preview</th>
                                        <th className="px-4 py-3">Docs</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {docTypes.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-10 text-center">
                                                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                                                    <FolderOpen
                                                        className="size-10 text-muted-foreground"
                                                        strokeWidth={1.5}
                                                        aria-hidden="true"
                                                    />
                                                    <p className="text-sm text-muted-foreground">
                                                        No document types configured yet.
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        docTypes.map((item) => {
                                            const busy = togglingId === item.id;
                                            return (
                                                <tr
                                                    key={item.id}
                                                    className={
                                                        editing?.id === item.id
                                                            ? "bg-brand-soft/35"
                                                            : undefined
                                                    }
                                                >
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium">{item.name}</p>
                                                        <p className="font-mono text-xs text-muted-foreground">
                                                            {item.slug}
                                                        </p>
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                        {formatDrivePathPreview(
                                                            activeTermName,
                                                            item.driveFolderSegment,
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-xs">
                                                        {item.documentCount}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {item.isActive ? (
                                                            <Badge variant="success">
                                                                <CheckCircle2
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                ACTIVE
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="neutral">
                                                                <Archive
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                INACTIVE
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <div className="inline-flex flex-wrap justify-end gap-2">
                                                            <Button
                                                                type="button"
                                                                variant="secondary"
                                                                size="sm"
                                                                onClick={() => startEditing(item)}
                                                            >
                                                                <Pencil
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                                <span>Edit</span>
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="secondary"
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() =>
                                                                    void handleToggleActive(item)
                                                                }
                                                            >
                                                                {busy ? (
                                                                    <Loader2
                                                                        className="size-3.5 animate-spin"
                                                                        strokeWidth={1.75}
                                                                        aria-hidden="true"
                                                                    />
                                                                ) : item.isActive ? (
                                                                    <Archive
                                                                        className="size-3.5"
                                                                        strokeWidth={1.75}
                                                                        aria-hidden="true"
                                                                    />
                                                                ) : (
                                                                    <RotateCcw
                                                                        className="size-3.5"
                                                                        strokeWidth={1.75}
                                                                        aria-hidden="true"
                                                                    />
                                                                )}
                                                                <span>
                                                                    {item.isActive
                                                                        ? "Disable"
                                                                        : "Reactivate"}
                                                                </span>
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Create Document Type</CardTitle>
                        <CardDescription>
                            Add a new organizational category for Drive classification.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="dt-create-name" className="text-xs font-medium">
                                    Display Name
                                </label>
                                <Input
                                    id="dt-create-name"
                                    placeholder="Financial Reports"
                                    value={createName}
                                    onChange={(e) => handleCreateNameChange(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="dt-create-slug" className="text-xs font-medium">
                                    Stable Slug (immutable after creation)
                                </label>
                                <Input
                                    id="dt-create-slug"
                                    placeholder="financial-reports"
                                    className="font-mono text-xs"
                                    value={createSlug}
                                    onChange={(e) => {
                                        setSlugEditedManually(true);
                                        setCreateSlug(e.target.value);
                                    }}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="dt-create-segment" className="text-xs font-medium">
                                    Drive Folder Segment
                                </label>
                                <Input
                                    id="dt-create-segment"
                                    placeholder="Financial Reports"
                                    className="font-mono text-xs"
                                    value={createSegment}
                                    onChange={(e) => {
                                        setSegmentEditedManually(true);
                                        setCreateSegment(e.target.value);
                                    }}
                                    required
                                />
                            </div>

                            <div className="rounded-md border border-border bg-muted px-3 py-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                    Destination Path Preview
                                </p>
                                <p className="mt-1 break-all font-mono text-xs text-foreground">
                                    {createPreviewPath}
                                </p>
                            </div>

                            <Button type="submit" disabled={creating} className="mt-1">
                                {creating ? (
                                    <Loader2
                                        className="size-4 animate-spin"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <FolderPlus
                                        className="size-4"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                )}
                                <span>{creating ? "Creating..." : "Create Document Type"}</span>
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>

            {editing ? (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Edit Document Type &mdash;{" "}
                            <span className="font-mono text-sm">{editing.slug}</span>
                        </CardTitle>
                        <CardDescription>
                            Slug remains immutable to keep cached Google Drive paths aligned.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleEditSubmit} className="grid gap-3 md:grid-cols-4">
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="dt-edit-name" className="text-xs font-medium">
                                    Display Name
                                </label>
                                <Input
                                    id="dt-edit-name"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="dt-edit-segment" className="text-xs font-medium">
                                    Drive Folder Segment
                                </label>
                                <Input
                                    id="dt-edit-segment"
                                    className="font-mono text-xs"
                                    value={editSegment}
                                    onChange={(e) => setEditSegment(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-1.5 md:col-span-2">
                                <label htmlFor="dt-edit-reason" className="text-xs font-medium">
                                    Audit Reason (optional)
                                </label>
                                <Input
                                    id="dt-edit-reason"
                                    placeholder="e.g., Standardize folder naming for AY 2026-2027"
                                    value={editReason}
                                    onChange={(e) => setEditReason(e.target.value)}
                                />
                            </div>

                            <div className="rounded-md border border-border bg-muted px-3 py-2 md:col-span-4">
                                <span className="text-xs font-medium text-muted-foreground">
                                    Updated Path Preview:{" "}
                                </span>
                                <span className="font-mono text-xs text-foreground">
                                    {editPreviewPath}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
                                <Button type="submit" disabled={savingEdit}>
                                    {savingEdit ? (
                                        <Loader2
                                            className="size-4 animate-spin"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                    <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setEditing(null)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            ) : null}

            {isSuperAdmin && systemSettings ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Runtime Configuration &amp; Integration Readiness</CardTitle>
                        <CardDescription>
                            Read-only summary of non-secret server settings. Credentials and API keys
                            are managed exclusively via server environment variables.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <dl className="divide-y divide-border border-t border-border text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Active Academic Term</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {activeTerm
                                        ? `${activeTerm.code} (${activeTerm.name})`
                                        : "No active term"}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">University Email Domain</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {systemSettings.runtime.universityEmailDomain ?? "Unset"}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Application URL</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {systemSettings.runtime.appUrl}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Email Provider &amp; Sender</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {systemSettings.runtime.emailProvider} &middot;{" "}
                                    {systemSettings.runtime.emailFrom}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Drive Share Mode</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {systemSettings.runtime.driveShareMode}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Max Upload Size</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {(
                                        systemSettings.runtime.maxUploadSizeBytes /
                                        (1024 * 1024)
                                    ).toFixed(2)}{" "}
                                    MB ({systemSettings.runtime.maxUploadSizeBytes} bytes)
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Cached Drive Folders</dt>
                                <dd className="font-mono text-xs font-medium">
                                    {systemSettings.cachedDriveFoldersCount}
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">PostgreSQL Database</dt>
                                <dd>
                                    <ReadinessBadge
                                        configured={systemSettings.integrations.databaseConnected}
                                    />
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Google Drive OAuth2</dt>
                                <dd>
                                    <ReadinessBadge
                                        configured={systemSettings.integrations.driveConfigured}
                                    />
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">
                                    Transactional Email Transport
                                </dt>
                                <dd>
                                    <ReadinessBadge
                                        configured={
                                            systemSettings.integrations.emailTransportConfigured
                                        }
                                    />
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">OTP HMAC Secret</dt>
                                <dd>
                                    <ReadinessBadge
                                        configured={systemSettings.integrations.otpSecretConfigured}
                                    />
                                </dd>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                                <dt className="text-muted-foreground">Upload Intent Secret</dt>
                                <dd>
                                    <ReadinessBadge
                                        configured={
                                            systemSettings.integrations.uploadIntentSecretConfigured
                                        }
                                    />
                                </dd>
                            </div>
                        </dl>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}
