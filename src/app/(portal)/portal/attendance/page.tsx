import { and, desc, eq, inArray } from "drizzle-orm";
import { Check, ClipboardCheck, ClockAlert, FileCheck, X } from "lucide-react";
import { getDb } from "@/db";
import { attendanceCheckpoints, attendanceRecords, events } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

function AttendanceStatusBadge({ status }: { status: "PRESENT" | "LATE" | "EXCUSED" | "ABSENT" }) {
    if (status === "PRESENT") {
        return (
            <Badge variant="success">
                <Check className="size-3" strokeWidth={1.75} aria-hidden="true" />
                PRESENT
            </Badge>
        );
    }
    if (status === "LATE") {
        return (
            <Badge variant="warning">
                <ClockAlert className="size-3" strokeWidth={1.75} aria-hidden="true" />
                LATE
            </Badge>
        );
    }
    if (status === "EXCUSED") {
        return (
            <Badge variant="info">
                <FileCheck className="size-3" strokeWidth={1.75} aria-hidden="true" />
                EXCUSED
            </Badge>
        );
    }
    return (
        <Badge variant="destructive">
            <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
            ABSENT
        </Badge>
    );
}

export default async function PortalAttendancePage() {
    const { actor } = await requireServerAuth("attendance:self:view");
    const db = getDb();

    const rows = await db
        .select({
            id: attendanceRecords.id,
            status: attendanceRecords.status,
            recordedAt: attendanceRecords.recordedAt,
            checkpointLabel: attendanceCheckpoints.label,
            eventTitle: events.title,
        })
        .from(attendanceRecords)
        .innerJoin(
            attendanceCheckpoints,
            eq(attendanceRecords.checkpointId, attendanceCheckpoints.id),
        )
        .innerJoin(events, eq(attendanceCheckpoints.eventId, events.id))
        .where(
            and(
                eq(attendanceRecords.userId, actor.id),
                inArray(events.status, ["PUBLISHED", "COMPLETED"]),
            ),
        )
        .orderBy(desc(attendanceRecords.recordedAt));

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">My Attendance</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Read-only attendance log for{" "}
                    <span className="font-mono text-foreground">{actor.studentIdNumber}</span>.
                    Contact an Executive in person for discrepancy corrections.
                </p>
            </div>

            {rows.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <ClipboardCheck
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            No attendance records logged yet.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">Checkpoint</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Recorded (UTC)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="px-4 py-3 font-medium">{row.eventTitle}</td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                        {row.checkpointLabel}
                                    </td>
                                    <td className="px-4 py-3">
                                        <AttendanceStatusBadge status={row.status} />
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                        {row.recordedAt.toISOString().slice(0, 19).replace("T", " ")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
