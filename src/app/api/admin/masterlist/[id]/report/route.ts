import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { masterlistImports } from "@/db/schema";
import {
    buildMasterlistReportCsv,
    type MasterlistReportSummary,
} from "@/lib/admin/masterlist";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiError, apiErrorResponse, getServerSession } from "@/lib/auth/server";

const uuidSchema = z.string().uuid("Invalid import ID.");

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "masterlist:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const importId = uuidSchema.parse(id);

        const [record] = await db
            .select({
                id: masterlistImports.id,
                reportSummary: masterlistImports.reportSummary,
            })
            .from(masterlistImports)
            .where(eq(masterlistImports.id, importId))
            .limit(1);

        if (!record) {
            return apiError(404, "IMPORT_NOT_FOUND", "Masterlist import record not found.");
        }

        const csv = buildMasterlistReportCsv(
            (record.reportSummary as MasterlistReportSummary | null) ?? null,
        );

        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="masterlist-report-${record.id}.csv"`,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
