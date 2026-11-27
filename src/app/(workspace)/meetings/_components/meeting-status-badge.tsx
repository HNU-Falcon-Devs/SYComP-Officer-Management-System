"use client";

import { Ban, Calendar, CheckCheck, PlayCircle } from "lucide-react";
import type { MeetingStatus } from "@/app/api/meetings/_lib/validation";
import { Badge } from "@/components/ui/badge";

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
    if (status === "ONGOING") {
        return (
            <Badge variant="success">
                <PlayCircle className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                ONGOING
            </Badge>
        );
    }
    if (status === "COMPLETED") {
        return (
            <Badge variant="neutral">
                <CheckCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                COMPLETED
            </Badge>
        );
    }
    if (status === "CANCELLED") {
        return (
            <Badge variant="destructive">
                <Ban className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                CANCELLED
            </Badge>
        );
    }
    return (
        <Badge variant="brand">
            <Calendar className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            SCHEDULED
        </Badge>
    );
}
