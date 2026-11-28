import {
    AlertTriangle,
    CheckCircle2,
    Circle,
    ClockAlert,
    Eye,
    Loader,
} from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/app/api/tasks/_lib/validation";
import { Badge } from "@/components/ui/badge";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
    switch (status) {
        case "TO_DO":
            return (
                <Badge variant="neutral">
                    <Circle className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    TO DO
                </Badge>
            );
        case "IN_PROGRESS":
            return (
                <Badge variant="info">
                    <Loader className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    IN PROGRESS
                </Badge>
            );
        case "FOR_REVIEW":
            return (
                <Badge variant="warning">
                    <Eye className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    FOR REVIEW
                </Badge>
            );
        case "DONE":
            return (
                <Badge variant="success">
                    <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    DONE
                </Badge>
            );
    }
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
    switch (priority) {
        case "URGENT":
            return (
                <Badge variant="destructive">
                    <AlertTriangle className="size-3" strokeWidth={1.75} aria-hidden="true" />
                    URGENT
                </Badge>
            );
        case "HIGH":
            return <Badge variant="warning">HIGH</Badge>;
        case "MEDIUM":
            return <Badge variant="brand">MEDIUM</Badge>;
        case "LOW":
            return <Badge variant="neutral">LOW</Badge>;
    }
}

export function TaskOverdueBadge() {
    return (
        <Badge variant="destructive">
            <ClockAlert className="size-3" strokeWidth={1.75} aria-hidden="true" />
            OVERDUE
        </Badge>
    );
}
