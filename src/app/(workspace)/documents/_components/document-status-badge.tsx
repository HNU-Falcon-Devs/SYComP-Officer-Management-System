"use client";

import { Archive, CheckCircle2, Eye, FileEdit, Link2, Send } from "lucide-react";
import type { DocumentStatus, DocumentStorageMode } from "@/lib/drive/validation";
import { Badge } from "@/components/ui/badge";

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
    if (status === "APPROVED") {
        return (
            <Badge variant="success">
                <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                APPROVED
            </Badge>
        );
    }
    if (status === "SUBMITTED") {
        return (
            <Badge variant="info">
                <Send className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                SUBMITTED
            </Badge>
        );
    }
    if (status === "FOR_REVIEW") {
        return (
            <Badge variant="warning">
                <Eye className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                FOR REVIEW
            </Badge>
        );
    }
    if (status === "ARCHIVED") {
        return (
            <Badge variant="neutral">
                <Archive className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                ARCHIVED
            </Badge>
        );
    }
    return (
        <Badge variant="neutral">
            <FileEdit className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            DRAFT
        </Badge>
    );
}

export function StorageModeBadge({ mode }: { mode: DocumentStorageMode }) {
    if (mode === "EXTERNAL_LINK") {
        return (
            <Badge variant="neutral">
                <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                External URL
            </Badge>
        );
    }
    return <Badge variant="brand">Drive Upload</Badge>;
}
