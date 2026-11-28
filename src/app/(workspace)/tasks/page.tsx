import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import { loadTasksWorkspaceMeta, queryTasksList } from "@/app/api/tasks/_lib/queries";
import { TASKS_DEFAULT_LIMIT } from "@/app/api/tasks/_lib/validation";
import { TasksWorkspace } from "./_components/tasks-workspace";

export default async function TasksPage() {
    const { actor } = await requireServerAuth("event:workspace:view");
    const db = getDb();

    const defaultScope = actor.systemRole === "OFFICER" ? "mine" : "all";

    const [listResult, meta] = await Promise.all([
        queryTasksList(db, actor, {
            scope: defaultScope,
            generalOnly: false,
            overdueOnly: false,
            page: 1,
            limit: TASKS_DEFAULT_LIMIT,
        }),
        loadTasksWorkspaceMeta(db, actor.id),
    ]);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">My Tasks &amp; Deliverables</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Consolidated personal officer task queue and organizational/event committee
                    deliverable board.
                </p>
            </div>
            <TasksWorkspace
                actorId={actor.id}
                userRole={actor.systemRole}
                defaultScope={defaultScope}
                initialItems={listResult.items}
                initialTotal={listResult.total}
                terms={meta.terms}
                activeTerm={meta.activeTerm}
                events={meta.events}
                committees={meta.committees}
                eligibleOfficers={meta.eligibleOfficers}
                documents={meta.documents}
            />
        </div>
    );
}
