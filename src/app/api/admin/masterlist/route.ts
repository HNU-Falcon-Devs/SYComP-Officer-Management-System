import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, masterlistImports, users } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

export async function GET() {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "masterlist:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const rows = await db
            .select({
                id: masterlistImports.id,
                academicTermId: masterlistImports.academicTermId,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                uploadedByName: users.fullName,
                sourceFilename: masterlistImports.sourceFilename,
                totalRows: masterlistImports.totalRows,
                createdCount: masterlistImports.createdCount,
                skippedExistingCount: masterlistImports.skippedExistingCount,
                flaggedReviewCount: masterlistImports.flaggedReviewCount,
                reportSummary: masterlistImports.reportSummary,
                createdAt: masterlistImports.createdAt,
            })
            .from(masterlistImports)
            .innerJoin(academicTerms, eq(masterlistImports.academicTermId, academicTerms.id))
            .innerJoin(users, eq(masterlistImports.uploadedBy, users.id))
            .orderBy(desc(masterlistImports.createdAt))
            .limit(25);

        return apiJson({
            imports: rows.map((row) => ({
                ...row,
                createdAt: row.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
