import { getDb } from "@/db";
import {
    loadOpenScannerCheckpoints,
    queryAttendanceRecordsList,
} from "@/lib/attendance/validation";
import { requireServerAuth } from "@/lib/auth/server";
import { QrScannerWorkspace } from "@/components/scanner/qr-scanner-workspace";

interface ScannerPageProps {
    searchParams: Promise<{ checkpointId?: string }>;
}

export default async function ScannerPage({ searchParams }: ScannerPageProps) {
    const { actor } = await requireServerAuth("attendance:export");
    const { checkpointId } = await searchParams;
    const db = getDb();

    const openCheckpoints = await loadOpenScannerCheckpoints(db, actor.systemRole);
    const requestedCheckpoint = checkpointId
        ? openCheckpoints.find((cp) => cp.id === checkpointId)
        : undefined;
    const initialCheckpointId = requestedCheckpoint?.id ?? openCheckpoints[0]?.id ?? null;

    const initialRecentScans = initialCheckpointId
        ? (
              await queryAttendanceRecordsList(
                  db,
                  { checkpointId: initialCheckpointId },
                  { page: 1, limit: 10, includeActors: false },
              )
          ).items
        : [];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">QR Attendance Scanner</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Live two-step verification (Scan, Verify Card, Confirm) against active server
                    checkpoints.
                </p>
            </div>
            <QrScannerWorkspace
                actorRole={actor.systemRole}
                initialCheckpoints={openCheckpoints}
                initialSelectedCheckpointId={initialCheckpointId}
                initialRecentScans={initialRecentScans}
            />
        </div>
    );
}
