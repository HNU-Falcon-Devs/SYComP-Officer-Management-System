import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { ACCOUNT_STATUSES, SYSTEM_ROLES } from "@/config/permissions";
import { getDb } from "@/db";
import { academicTerms, officerAppointments, users } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { toSafeUserDto } from "@/lib/auth/dto";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

const querySchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    role: z.enum(SYSTEM_ROLES).optional(),
    termId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
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
            page: url.searchParams.get("page") || undefined,
            limit: url.searchParams.get("limit") || undefined,
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
        const offset = (parsed.page - 1) * parsed.limit;

        const [[{ total }], userRows, activeTerms] = await Promise.all([
            db.select({ total: count() }).from(users).where(whereClause),
            db
                .select({
                    id: users.id,
                    studentIdNumber: users.studentIdNumber,
                    firstName: users.firstName,
                    middleName: users.middleName,
                    lastName: users.lastName,
                    fullName: users.fullName,
                    universityEmail: users.universityEmail,
                    emailVerifiedAt: users.emailVerifiedAt,
                    mustChangePassword: users.mustChangePassword,
                    systemRole: users.systemRole,
                    accountStatus: users.accountStatus,
                    statusReason: users.statusReason,
                    lastLoginAt: users.lastLoginAt,
                    createdAt: users.createdAt,
                })
                .from(users)
                .where(whereClause)
                .orderBy(asc(users.lastName), asc(users.firstName))
                .limit(parsed.limit)
                .offset(offset),
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
                          grantedSystemRole: officerAppointments.grantedSystemRole,
                          isCurrent: officerAppointments.isCurrent,
                      })
                      .from(officerAppointments)
                      .where(
                          and(
                              eq(officerAppointments.academicTermId, targetTermId),
                              inArray(officerAppointments.userId, userIds),
                          ),
                      )
                : [];

        const apptsByUser = new Map<string, typeof appts>();
        for (const appt of appts) {
            const list = apptsByUser.get(appt.userId) ?? [];
            list.push(appt);
            apptsByUser.set(appt.userId, list);
        }

        return apiJson({
            items: userRows.map((u) => ({
                ...toSafeUserDto(u),
                appointments: apptsByUser.get(u.id) ?? [],
            })),
            pagination: {
                page: parsed.page,
                limit: parsed.limit,
                total: Number(total),
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
