import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, users } from "@/db/schema";
import {
    AUDIT_LOG_EXPORT_LIMIT,
    auditLogsFilterSchema,
    buildAuditLogConditions,
    parseAuditSearchParams,
    toAuditLogDto,
} from "@/lib/admin/audit-logs";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, getServerSession } from "@/lib/auth/server";
import { formatCsvRow } from "@/lib/security/csv-safe";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "audit_log:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const parsed = auditLogsFilterSchema.parse(parseAuditSearchParams(url.searchParams));
        const conditions = buildAuditLogConditions(parsed);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const rows = await db
            .select({
                id: auditLogs.id,
                createdAt: auditLogs.createdAt,
                action: auditLogs.action,
                entityType: auditLogs.entityType,
                entityId: auditLogs.entityId,
                reason: auditLogs.reason,
                ipAddress: auditLogs.ipAddress,
                beforeState: auditLogs.beforeState,
                afterState: auditLogs.afterState,
                actorId: auditLogs.actorId,
                actorStudentIdNumber: users.studentIdNumber,
                actorFullName: users.fullName,
                actorSystemRole: users.systemRole,
            })
            .from(auditLogs)
            .leftJoin(users, eq(auditLogs.actorId, users.id))
            .where(whereClause)
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
            .limit(AUDIT_LOG_EXPORT_LIMIT + 1);

        const truncated = rows.length > AUDIT_LOG_EXPORT_LIMIT;
        const exportRows = truncated ? rows.slice(0, AUDIT_LOG_EXPORT_LIMIT) : rows;

        const lines: string[] = [
            formatCsvRow([
                "Timestamp (UTC)",
                "Action",
                "Entity Type",
                "Entity ID",
                "Actor ID",
                "Actor Name",
                "Break-Glass",
                "Reason",
                "IP Address",
                "Before State (Redacted)",
                "After State (Redacted)",
            ]),
        ];

        for (const row of exportRows) {
            const dto = toAuditLogDto(row);
            lines.push(
                formatCsvRow([
                    dto.createdAt,
                    dto.action,
                    dto.entityType,
                    dto.entityId,
                    dto.actor?.studentIdNumber ?? "SYSTEM",
                    dto.actor?.fullName ?? "System",
                    dto.isBreakGlass ? "YES" : "NO",
                    dto.reason ?? "",
                    dto.ipAddress ?? "",
                    dto.beforeState ? JSON.stringify(dto.beforeState) : "",
                    dto.afterState ? JSON.stringify(dto.afterState) : "",
                ]),
            );
        }

        return new Response(`${lines.join("\r\n")}\r\n`, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="sycomp-audit-logs.csv"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Export-Limit": String(AUDIT_LOG_EXPORT_LIMIT),
                "X-Export-Truncated": truncated ? "true" : "false",
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
