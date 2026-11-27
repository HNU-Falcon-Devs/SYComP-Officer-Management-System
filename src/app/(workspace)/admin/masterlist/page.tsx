import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, masterlistImports, users } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import {
    MasterlistImporter,
    type ImportHistoryDto,
} from "@/components/admin/masterlist-importer";

export default async function AdminMasterlistPage() {
    const { actor } = await requireServerAuth("masterlist:view");
    const db = getDb();

    const [activeTerms, importRows] = await Promise.all([
        db
            .select({ code: academicTerms.code })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1),
        db
            .select({
                id: masterlistImports.id,
                termCode: academicTerms.code,
                uploadedByName: users.fullName,
                sourceFilename: masterlistImports.sourceFilename,
                totalRows: masterlistImports.totalRows,
                createdCount: masterlistImports.createdCount,
                skippedExistingCount: masterlistImports.skippedExistingCount,
                flaggedReviewCount: masterlistImports.flaggedReviewCount,
                createdAt: masterlistImports.createdAt,
            })
            .from(masterlistImports)
            .innerJoin(academicTerms, eq(masterlistImports.academicTermId, academicTerms.id))
            .innerJoin(users, eq(masterlistImports.uploadedBy, users.id))
            .orderBy(desc(masterlistImports.createdAt))
            .limit(25),
    ]);

    const initialHistory: ImportHistoryDto[] = importRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
    }));

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Student Masterlist</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Provision enrolled computing students and inspect import discrepancy summaries.
                </p>
            </div>
            <MasterlistImporter
                isSuperAdmin={actor.systemRole === "SUPER_ADMIN"}
                activeTermCode={activeTerms[0]?.code ?? null}
                initialHistory={initialHistory}
            />
        </div>
    );
}
