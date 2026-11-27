import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { ACCOUNT_STATUSES, SYSTEM_ROLES } from "@/config/permissions";
import { getDb } from "@/db";
import { academicTerms, officerAppointments, users } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, getServerSession } from "@/lib/auth/server";
import { formatCsvRow } from "@/lib/security/csv-safe";

const querySchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    role: z.enum(SYSTEM_ROLES).optional(),
    termId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "directory:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const parsed = querySchema.parse({
            q: url.searchParams.get("q") || undefined,
            status: url.searchParams.get("status") || undefined,
            role: url.searchParams.get("role") || undefined,
            termId: url.searchParams.get("termId") || undefined,
        });

        const conditions = [];
        if (parsed.q) {
            const pattern = `%${parsed.q}%`;
            conditions.push(
                or(
                    ilike(users.studentIdNumber, pattern),
                    ilike(users.fullName, pattern),
                    ilike(users.universityEmail, pattern),
                ),
            );
        }
        if (parsed.status) {
            conditions.push(eq(users.accountStatus, parsed.status));
        }
        if (parsed.role) {
            conditions.push(eq(users.systemRole, parsed.role));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [userRows, activeTerms] = await Promise.all([
            db
                .select({
                    id: users.id,
                    studentIdNumber: users.studentIdNumber,
                    fullName: users.fullName,
                    systemRole: users.systemRole,
                    accountStatus: users.accountStatus,
                })
                .from(users)
                .where(whereClause)
                .orderBy(asc(users.lastName), asc(users.firstName))
                .limit(2000),
            parsed.termId
                ? Promise.resolve([{ id: parsed.termId }])
                : db
                      .select({ id: academicTerms.id })
                      .from(academicTerms)
                      .where(eq(academicTerms.status, "ACTIVE"))
                      .limit(1),
        ]);

        const targetTermId = activeTerms[0]?.id ?? null;
        const userIds = userRows.map((u) => u.id);

        const appts =
            targetTermId && userIds.length > 0
                ? await db
                      .select({
                          userId: officerAppointments.userId,
                          positionTitle: officerAppointments.positionTitle,
                      })
                      .from(officerAppointments)
                      .where(
                          and(
                              eq(officerAppointments.academicTermId, targetTermId),
                              inArray(officerAppointments.userId, userIds),
                          ),
                      )
                : [];

        const titleByUser = new Map<string, string[]>();
        for (const a of appts) {
            const list = titleByUser.get(a.userId) ?? [];
            list.push(a.positionTitle);
            titleByUser.set(a.userId, list);
        }

        const lines: string[] = [
            formatCsvRow([
                "Student ID",
                "Full Name",
                "System Role",
                "Account Status",
                "Position Title",
            ]),
        ];

        for (const u of userRows) {
            lines.push(
                formatCsvRow([
                    u.studentIdNumber,
                    u.fullName,
                    u.systemRole,
                    u.accountStatus,
                    (titleByUser.get(u.id) ?? []).join("; "),
                ]),
            );
        }

        return new Response(`${lines.join("\r\n")}\r\n`, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="sycomp-directory.csv"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
