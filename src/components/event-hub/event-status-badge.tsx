import {
    Archive,
    CheckCircle2,
    Clock,
    FileEdit,
    Globe,
    RotateCcw,
    XCircle,
} from "lucide-react";
import type { EventStatus } from "@/app/api/events/_lib/validation";
import { Badge } from "@/components/ui/badge";

export function EventStatusBadge({ status }: { status: EventStatus }) {
    switch (status) {
        case "DRAFT":
            return (
                <Badge variant="neutral">
                    <FileEdit className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    DRAFT
                </Badge>
            );
        case "PENDING_REVIEW":
            return (
                <Badge variant="warning">
                    <Clock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    PENDING REVIEW
                </Badge>
            );
        case "NEEDS_REVISION":
            return (
                <Badge variant="warning">
                    <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    NEEDS REVISION
                </Badge>
            );
        case "APPROVED":
            return (
                <Badge variant="brand">
                    <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    APPROVED
                </Badge>
            );
        case "PUBLISHED":
            return (
                <Badge variant="success">
                    <Globe className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    PUBLISHED
                </Badge>
            );
        case "COMPLETED":
            return (
                <Badge variant="neutral">
                    <Archive className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    COMPLETED
                </Badge>
            );
        case "REJECTED":
            return (
                <Badge variant="destructive">
                    <XCircle className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    REJECTED
                </Badge>
            );
    }
}
