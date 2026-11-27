import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { loadDocumentMetadataOptions, queryDocumentsList } from "@/lib/drive/queries";
import { DOCUMENTS_DEFAULT_LIMIT } from "@/lib/drive/validation";
import { DocumentsRegistry } from "./_components/documents-registry";

export default async function DocumentsPage() {
    const { actor } = await requireServerAuth("document:view");
    const db = getDb();
    const env = getEnv();

    const [listResult, meta] = await Promise.all([
        queryDocumentsList(db, { page: 1, limit: DOCUMENTS_DEFAULT_LIMIT }),
        loadDocumentMetadataOptions(db),
    ]);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Centralized Google Drive document repository classified by academic term,
                    category, and linked event.
                </p>
            </div>
            <DocumentsRegistry
                userRole={actor.systemRole}
                initialItems={listResult.items}
                initialTotal={listResult.total}
                documentTypes={meta.documentTypes}
                terms={meta.terms}
                activeTerm={meta.activeTerm}
                events={meta.events}
                driveShareMode={env.DRIVE_SHARE_MODE}
                maxUploadSizeBytes={env.MAX_UPLOAD_SIZE_BYTES}
            />
        </div>
    );
}
