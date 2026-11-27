import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { loadMeetingsPageMeta, queryMeetingsList } from "@/app/api/meetings/_lib/queries";
import { MEETINGS_DEFAULT_LIMIT } from "@/app/api/meetings/_lib/validation";
import { MeetingsWorkspace } from "./_components/meetings-workspace";

export default async function MeetingsPage() {
    const { actor } = await requireServerAuth("meeting:view");
    const db = getDb();

    const [listResult, meta] = await Promise.all([
        queryMeetingsList(db, { page: 1, limit: MEETINGS_DEFAULT_LIMIT }),
        loadMeetingsPageMeta(db),
    ]);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Officer Meetings</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Internal officer assembly schedules, agendas, Minutes of Meeting, and
                    Executive-governed officer attendance checkpoints.
                </p>
            </div>
            <MeetingsWorkspace
                userRole={actor.systemRole}
                initialItems={listResult.items}
                initialTotal={listResult.total}
                terms={meta.terms}
                activeTerm={meta.activeTerm}
            />
        </div>
    );
}
