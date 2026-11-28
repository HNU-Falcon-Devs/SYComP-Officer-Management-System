import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { loadEventsPageMeta, queryEventsList } from "@/app/api/events/_lib/queries";
import { EVENTS_DEFAULT_LIMIT } from "@/app/api/events/_lib/validation";
import { EventsWorkspace } from "./_components/events-workspace";

export default async function EventsPage() {
    const { actor } = await requireServerAuth("event:workspace:view");
    const db = getDb();

    const [listResult, meta] = await Promise.all([
        queryEventsList(db, actor, { page: 1, limit: EVENTS_DEFAULT_LIMIT }),
        loadEventsPageMeta(db),
    ]);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Events &amp; Proposals</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Collaborative officer proposal board, Executive approval workflow, event-scoped
                    committees, and live calendar publishing.
                </p>
            </div>
            <EventsWorkspace
                initialItems={listResult.items}
                initialTotal={listResult.total}
                terms={meta.terms}
                activeTerm={meta.activeTerm}
            />
        </div>
    );
}
