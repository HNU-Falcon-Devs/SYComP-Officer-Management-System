import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, documentTypes, driveFolderCache } from "@/db/schema";
import { buildSystemSettingsSummary } from "@/lib/admin/settings";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

export async function GET() {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "system_settings:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const [activeTerms, [{ totalDocTypes }], [{ activeDocTypes }], [{ cachedFolders }]] =
            await Promise.all([
                db
                    .select({
                        id: academicTerms.id,
                        code: academicTerms.code,
                        name: academicTerms.name,
                        startDate: academicTerms.startDate,
                        endDate: academicTerms.endDate,
                    })
                    .from(academicTerms)
                    .where(eq(academicTerms.status, "ACTIVE"))
                    .limit(1),
                db.select({ totalDocTypes: count() }).from(documentTypes),
                db
                    .select({ activeDocTypes: count() })
                    .from(documentTypes)
                    .where(eq(documentTypes.isActive, true)),
                db.select({ cachedFolders: count() }).from(driveFolderCache),
            ]);

        const summary = buildSystemSettingsSummary(process.env);

        return apiJson(
            {
                ...summary,
                activeTerm: activeTerms[0] ?? null,
                stats: {
                    documentTypesTotal: Number(totalDocTypes),
                    documentTypesActive: Number(activeDocTypes),
                    cachedDriveFoldersCount: Number(cachedFolders),
                },
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
