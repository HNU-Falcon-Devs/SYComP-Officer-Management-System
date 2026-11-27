import { getDb } from "@/db";
import {
    ATTENDANCE_EXPORT_LIMIT,
    attendanceRecordsFilterSchema,
    parseAttendanceSearchParams,
    queryAttendanceRecordsList,
} from "@/lib/attendance/validation";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, getServerSession } from "@/lib/auth/server";
import { formatCsvRow } from "@/lib/security/csv-safe";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "attendance:export",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const parsed = attendanceRecordsFilterSchema.parse(
            parseAttendanceSearchParams(url.searchParams),
        );

        const { items } = await queryAttendanceRecordsList(db, parsed, {
            page: 1,
            limit: ATTENDANCE_EXPORT_LIMIT + 1,
            includeActors: false,
        });

        const truncated = items.length > ATTENDANCE_EXPORT_LIMIT;
        const exportRows = truncated ? items.slice(0, ATTENDANCE_EXPORT_LIMIT) : items;

        // PII-minimized columns per docs/04 Sec 7.2 (no universityEmail, no internal notes)
        const lines: string[] = [
            formatCsvRow([
                "Student ID",
                "Full Name",
                "Checkpoint",
                "Status",
                "Recorded Via",
                "Recorded At (UTC)",
            ]),
        ];

        for (const row of exportRows) {
            lines.push(
                formatCsvRow([
                    row.studentIdNumber,
                    row.fullName,
                    row.checkpointLabel,
                    row.status,
                    row.recordedVia,
                    row.recordedAt,
                ]),
            );
        }

        return new Response(`${lines.join("\r\n")}\r\n`, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="sycomp-attendance.csv"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Export-Limit": String(ATTENDANCE_EXPORT_LIMIT),
                "X-Export-Truncated": truncated ? "true" : "false",
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
