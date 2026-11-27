import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, officerAppointments, users } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import {
    DirectoryTable,
    type DirectoryUserItem,
    type TermOption,
} from "@/components/admin/directory-table";

export default async function DirectoryPage() {
    const { actor } = await requireServerAuth("directory:view");
    const db = getDb();

    const [termsRows, [{ total }], userRows] = await Promise.all([
        db
            .select({
                id: academicTerms.id,
                code: academicTerms.code,
                status: academicTerms.status,
            })
            .from(academicTerms)
            .orderBy(desc(academicTerms.startDate)),
        db.select({ total: count() }).from(users),
        db
            .select({
                id: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                universityEmail: users.universityEmail,
                systemRole: users.systemRole,
                accountStatus: users.accountStatus,
                statusReason: users.statusReason,
            })
            .from(users)
            .orderBy(asc(users.lastName), asc(users.firstName))
            .limit(25),
    ]);

    const activeTerm = termsRows.find((t) => t.status === "ACTIVE") ?? termsRows[0] ?? null;
    const userIds = userRows.map((u) => u.id);

    const appts =
        activeTerm && userIds.length > 0
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
                          eq(officerAppointments.academicTermId, activeTerm.id),
                          inArray(officerAppointments.userId, userIds),
                      ),
                  )
            : [];

    const apptsByUser = new Map<string, DirectoryUserItem["appointments"]>();
    for (const a of appts) {
        const list = apptsByUser.get(a.userId) ?? [];
        list.push({
            positionTitle: a.positionTitle,
            grantedSystemRole: a.grantedSystemRole,
            isCurrent: a.isCurrent,
        });
        apptsByUser.set(a.userId, list);
    }

    const initialItems: DirectoryUserItem[] = userRows.map((u) => ({
        ...u,
        appointments: apptsByUser.get(u.id) ?? [],
    }));

    const termOptions: TermOption[] = termsRows;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Officer &amp; Member Directory
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Search active and historical records by Student ID, name, role, or lifecycle
                    status.
                </p>
            </div>
            <DirectoryTable
                isSuperAdmin={actor.systemRole === "SUPER_ADMIN"}
                initialItems={initialItems}
                initialTotal={Number(total)}
                terms={termOptions}
                initialTermId={activeTerm?.id ?? ""}
            />
        </div>
    );
}
