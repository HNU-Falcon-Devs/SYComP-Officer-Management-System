import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { AUDIT_LOG_DEFAULT_LIMIT, toAuditLogDto } from "@/lib/admin/audit-logs";
import { requireServerAuth } from "@/lib/auth/server";
import { AuditLogsLedger } from "@/components/admin/audit-logs-ledger";

export default async function AdminAuditLogsPage() {
    await requireServerAuth("audit_log:view");
    const db = getDb();

    const [[{ total }], rows, actionRows, entityTypeRows] = await Promise.all([
        db.select({ total: count() }).from(auditLogs),
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
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
            .limit(AUDIT_LOG_DEFAULT_LIMIT),
        db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action)),
        db
            .selectDistinct({ entityType: auditLogs.entityType })
            .from(auditLogs)
            .orderBy(asc(auditLogs.entityType)),
    ]);

    const initialItems = rows.map(toAuditLogDto);
    const actionOptions = actionRows.map((r) => r.action);
    const entityTypeOptions = entityTypeRows.map((r) => r.entityType);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Immutable, append-only governance ledger with redacted before/after state
                    snapshots.
                </p>
            </div>
            <AuditLogsLedger
                initialItems={initialItems}
                initialTotal={Number(total)}
                actionOptions={actionOptions}
                entityTypeOptions={entityTypeOptions}
            />
        </div>
    );
}
