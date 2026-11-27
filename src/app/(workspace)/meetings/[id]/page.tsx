import { notFound } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { loadCheckpointsWithCounts, queryAttendanceRecordsList } from "@/lib/attendance/validation";
import { requireServerAuth } from "@/lib/auth/server";
import { loadDocumentMetadataOptions, queryDocumentsList } from "@/lib/drive/queries";
import { hasActiveTermAppointment, loadMeetingDetailById } from "@/app/api/meetings/_lib/queries";
import { MeetingDetailWorkspace } from "../_components/meeting-detail-workspace";

const uuidSchema = z.string().uuid();

interface MeetingDetailPageProps {
    params: Promise<{ id: string }>;
}

export default async function MeetingDetailPage({ params }: MeetingDetailPageProps) {
    const { actor } = await requireServerAuth("meeting:view");
    const { id } = await params;

    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) {
        notFound();
    }

    const db = getDb();
    const loaded = await loadMeetingDetailById(db, parsedId.data);
    if (!loaded) {
        notFound();
    }

    const env = getEnv();
    const [checkpoints, attendanceRes, docsRes, docMeta, hasAppointment] = await Promise.all([
        loadCheckpointsWithCounts(db, { meetingId: loaded.dto.id }),
        queryAttendanceRecordsList(
            db,
            { meetingId: loaded.dto.id },
            { page: 1, limit: 25, includeActors: true },
        ),
        queryDocumentsList(db, { meetingId: loaded.dto.id, page: 1, limit: 50 }),
        loadDocumentMetadataOptions(db),
        actor.systemRole === "OFFICER"
            ? hasActiveTermAppointment(db, actor.id, loaded.dto.academicTerm.id)
            : Promise.resolve(true),
    ]);

    return (
        <MeetingDetailWorkspace
            userRole={actor.systemRole}
            hasActiveAppointment={hasAppointment}
            initialMeeting={loaded.dto}
            initialCheckpoints={checkpoints}
            initialAttendance={attendanceRes.items}
            initialDocuments={docsRes.items}
            documentTypes={docMeta.documentTypes}
            activeTerm={docMeta.activeTerm}
            driveShareMode={env.DRIVE_SHARE_MODE}
            maxUploadSizeBytes={env.MAX_UPLOAD_SIZE_BYTES}
        />
    );
}
