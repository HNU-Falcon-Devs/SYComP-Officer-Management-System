import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, documents, documentTypes, driveFolderCache, users } from "@/db/schema";
import { buildSystemSettingsSummary, type DocumentTypeDto } from "@/lib/admin/settings";
import { requireServerAuth } from "@/lib/auth/server";
import { SettingsManager } from "@/components/admin/settings-manager";

export default async function AdminSettingsPage() {
    const { actor } = await requireServerAuth("document_type:manage");
    const db = getDb();
    const isSuperAdmin = actor.systemRole === "SUPER_ADMIN";

    const [docTypeRows, docCounts, activeTerms, cachedFoldersCountResult] = await Promise.all([
        db
            .select({
                id: documentTypes.id,
                name: documentTypes.name,
                slug: documentTypes.slug,
                driveFolderSegment: documentTypes.driveFolderSegment,
                isActive: documentTypes.isActive,
                createdAt: documentTypes.createdAt,
                updatedAt: documentTypes.updatedAt,
                creatorId: users.id,
                creatorStudentIdNumber: users.studentIdNumber,
                creatorFullName: users.fullName,
            })
            .from(documentTypes)
            .leftJoin(users, eq(documentTypes.createdBy, users.id))
            .orderBy(desc(documentTypes.isActive), asc(documentTypes.name)),
        db
            .select({
                documentTypeId: documents.documentTypeId,
                total: count(),
            })
            .from(documents)
            .groupBy(documents.documentTypeId),
        db
            .select({
                id: academicTerms.id,
                code: academicTerms.code,
                name: academicTerms.name,
            })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1),
        isSuperAdmin
            ? db.select({ total: count() }).from(driveFolderCache)
            : Promise.resolve([{ total: 0 }]),
    ]);

    const countMap = new Map(docCounts.map((c) => [c.documentTypeId, Number(c.total)]));
    const initialDocumentTypes: DocumentTypeDto[] = docTypeRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        driveFolderSegment: row.driveFolderSegment,
        isActive: row.isActive,
        documentCount: countMap.get(row.id) ?? 0,
        createdBy: row.creatorId
            ? {
                  id: row.creatorId,
                  studentIdNumber: row.creatorStudentIdNumber ?? "",
                  fullName: row.creatorFullName ?? "",
              }
            : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }));

    const activeTerm = activeTerms[0] ?? null;
    const systemSettings = isSuperAdmin
        ? {
              ...buildSystemSettingsSummary(process.env),
              cachedDriveFoldersCount: Number(cachedFoldersCountResult[0]?.total ?? 0),
          }
        : null;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">System Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {isSuperAdmin
                        ? "Configure dynamic Google Drive document categories and inspect server-managed runtime readiness."
                        : "Manage dynamic document classifications and Google Drive folder segment mappings."}
                </p>
            </div>
            <SettingsManager
                isSuperAdmin={isSuperAdmin}
                activeTerm={activeTerm}
                initialDocumentTypes={initialDocumentTypes}
                systemSettings={systemSettings}
            />
        </div>
    );
}
