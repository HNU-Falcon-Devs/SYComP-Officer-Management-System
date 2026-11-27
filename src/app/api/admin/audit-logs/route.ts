import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, users } from "@/db/schema";
import {
    auditLogsListQuerySchema,
    buildAuditLogConditions,
    parseAuditSearchParams,
    toAuditLogDto,
} from "@/lib/admin/audit-logs";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

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
        const parsed = auditLogsListQuerySchema.parse(parseAuditSearchParams(url.searchParams));
        const conditions = buildAuditLogConditions(parsed);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const offset = (parsed.page - 1) * parsed.limit;

        const [[{ total }], rows] = await Promise.all([
            db
                .select({ total: count() })
                .from(auditLogs)
                .leftJoin(users, eq(auditLogs.actorId, users.id))
                .where(whereClause),
            db
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
                .limit(parsed.limit)
                .offset(offset),
        ]);

        return apiJson(
            {
                items: rows.map(toAuditLogDto),
                pagination: {
                    page: parsed.page,
                    limit: parsed.limit,
                    total: Number(total),
                },
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
