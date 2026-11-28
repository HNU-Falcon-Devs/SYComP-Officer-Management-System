import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { loadDocumentMetadataOptions } from "@/lib/drive/queries";
import { hasActiveTermOfficerAppointment } from "@/app/api/events/_lib/queries";
import { NewProposalForm } from "../_components/new-proposal-form";

export default async function NewEventProposalPage() {
    const { actor } = await requireServerAuth("event:workspace:view");
    const db = getDb();
    const env = getEnv();

    const docMeta = await loadDocumentMetadataOptions(db);
    const hasActiveAppointment =
        actor.systemRole === "SUPER_ADMIN" && docMeta.activeTerm
            ? await hasActiveTermOfficerAppointment(db, actor.id, docMeta.activeTerm.id)
            : true;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">New Event Proposal</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Draft a structured proposal with rich-text program details and optional Google
                    Drive supporting attachments.
                </p>
            </div>
            <NewProposalForm
                activeTerm={docMeta.activeTerm}
                documentTypes={docMeta.documentTypes}
                maxUploadSizeBytes={env.MAX_UPLOAD_SIZE_BYTES}
                requiresBreakGlass={actor.systemRole === "SUPER_ADMIN" && !hasActiveAppointment}
            />
        </div>
    );
}
