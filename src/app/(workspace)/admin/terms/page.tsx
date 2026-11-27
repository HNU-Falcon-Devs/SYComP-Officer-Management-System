import { count, desc, eq } from "drizzle-orm";
import { academicTerms, officerAppointments, users } from "@/db/schema";
import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { TermsManager, type AppointmentDto, type TermDto } from "@/components/admin/terms-manager";

export default async function AdminTermsPage() {
    const { actor } = await requireServerAuth("term:history:view");
    const db = getDb();

    const [termsRows, apptCountRows, activeUserRows] = await Promise.all([
        db
            .select()
            .from(academicTerms)
            .orderBy(desc(academicTerms.startDate), desc(academicTerms.createdAt)),
        db
            .select({
                academicTermId: officerAppointments.academicTermId,
                total: count(),
            })
            .from(officerAppointments)
            .groupBy(officerAppointments.academicTermId),
        actor.systemRole === "SUPER_ADMIN"
            ? db
                  .select({
                      id: users.id,
                      studentIdNumber: users.studentIdNumber,
                      fullName: users.fullName,
                      systemRole: users.systemRole,
                  })
                  .from(users)
                  .where(eq(users.accountStatus, "ACTIVE"))
                  .orderBy(users.lastName, users.firstName)
                  .limit(500)
            : Promise.resolve([]),
    ]);

    const countByTerm = new Map(apptCountRows.map((c) => [c.academicTermId, Number(c.total)]));
    const initialTerms: TermDto[] = termsRows.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status,
        appointmentCount: countByTerm.get(t.id) ?? 0,
    }));

    const selectedTerm =
        initialTerms.find((t) => t.status === "ACTIVE") ?? initialTerms[0] ?? null;

    let initialAppointments: AppointmentDto[] = [];
    if (selectedTerm) {
        const rows = await db
            .select({
                id: officerAppointments.id,
                userId: officerAppointments.userId,
                academicTermId: officerAppointments.academicTermId,
                positionTitle: officerAppointments.positionTitle,
                grantedSystemRole: officerAppointments.grantedSystemRole,
                isCurrent: officerAppointments.isCurrent,
                appointedAt: officerAppointments.appointedAt,
                endedAt: officerAppointments.endedAt,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                userSystemRole: users.systemRole,
            })
            .from(officerAppointments)
            .innerJoin(users, eq(officerAppointments.userId, users.id))
            .where(eq(officerAppointments.academicTermId, selectedTerm.id))
            .orderBy(desc(officerAppointments.isCurrent), desc(officerAppointments.appointedAt));

        initialAppointments = rows.map((r) => ({
            ...r,
            appointedAt: r.appointedAt.toISOString(),
            endedAt: r.endedAt ? r.endedAt.toISOString() : null,
        }));
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Academic Terms &amp; Officer Appointments
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Manage semester rollovers and preserve historical officer positions per term.
                </p>
            </div>
            <TermsManager
                isSuperAdmin={actor.systemRole === "SUPER_ADMIN"}
                initialTerms={initialTerms}
                initialSelectedTermId={selectedTerm?.id ?? null}
                initialAppointments={initialAppointments}
                activeUsers={activeUserRows}
            />
        </div>
    );
}
