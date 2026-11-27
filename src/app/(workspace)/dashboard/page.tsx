import Link from "next/link";
import { count, desc, eq, inArray } from "drizzle-orm";
import {
    CalendarDays,
    CheckSquare,
    Crown,
    FileSpreadsheet,
    Radio,
    ScrollText,
    ShieldAlert,
    UserCheck,
    Users,
} from "lucide-react";
import { ROUTES } from "@/config/routes";
import { getDb } from "@/db";
import {
    academicTerms,
    attendanceCheckpoints,
    auditLogs,
    eventCommittees,
    events,
    masterlistImports,
    meetings,
    taskAssignees,
    users,
} from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function WorkspaceDashboardPage() {
    const { actor } = await requireServerAuth("event:workspace:view");
    const db = getDb();

    const [
        activeTerms,
        openCheckpointsCount,
        pendingReviewCount,
        approvedUnpublishedCount,
        needsReviewUsersCount,
        activeUsersCount,
        myAssignedTasksCount,
        myHeadCommittees,
        recentEvents,
        recentMeetings,
        recentAudits,
        latestImport,
    ] = await Promise.all([
        db
            .select({ code: academicTerms.code, name: academicTerms.name })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1),
        db
            .select({ value: count() })
            .from(attendanceCheckpoints)
            .where(eq(attendanceCheckpoints.status, "OPEN")),
        db
            .select({ value: count() })
            .from(events)
            .where(eq(events.status, "PENDING_REVIEW")),
        db
            .select({ value: count() })
            .from(events)
            .where(eq(events.status, "APPROVED")),
        db
            .select({ value: count() })
            .from(users)
            .where(eq(users.accountStatus, "NEEDS_REVIEW")),
        db
            .select({ value: count() })
            .from(users)
            .where(eq(users.accountStatus, "ACTIVE")),
        db
            .select({ value: count() })
            .from(taskAssignees)
            .where(eq(taskAssignees.userId, actor.id)),
        db
            .select({ id: eventCommittees.id, name: eventCommittees.name })
            .from(eventCommittees)
            .where(eq(eventCommittees.headUserId, actor.id))
            .limit(5),
        db
            .select({
                id: events.id,
                title: events.title,
                status: events.status,
                startAt: events.startAt,
            })
            .from(events)
            .orderBy(desc(events.updatedAt))
            .limit(5),
        db
            .select({
                id: meetings.id,
                title: meetings.title,
                status: meetings.status,
                scheduledStartAt: meetings.scheduledStartAt,
            })
            .from(meetings)
            .where(inArray(meetings.status, ["SCHEDULED", "ONGOING"]))
            .orderBy(meetings.scheduledStartAt)
            .limit(3),
        actor.systemRole === "EXECUTIVE" || actor.systemRole === "SUPER_ADMIN"
            ? db
                  .select({
                      id: auditLogs.id,
                      action: auditLogs.action,
                      entityType: auditLogs.entityType,
                      createdAt: auditLogs.createdAt,
                  })
                  .from(auditLogs)
                  .orderBy(desc(auditLogs.createdAt))
                  .limit(5)
            : Promise.resolve([]),
        actor.systemRole === "SUPER_ADMIN"
            ? db
                  .select({
                      sourceFilename: masterlistImports.sourceFilename,
                      totalRows: masterlistImports.totalRows,
                      createdAt: masterlistImports.createdAt,
                  })
                  .from(masterlistImports)
                  .orderBy(desc(masterlistImports.createdAt))
                  .limit(1)
            : Promise.resolve([]),
    ]);

    const activeTerm = activeTerms[0] ?? null;
    const openCheckpoints = openCheckpointsCount[0]?.value ?? 0;
    const pendingProposals = pendingReviewCount[0]?.value ?? 0;
    const readyToPublish = approvedUnpublishedCount[0]?.value ?? 0;
    const flaggedUsers = needsReviewUsersCount[0]?.value ?? 0;
    const totalActiveUsers = activeUsersCount[0]?.value ?? 0;
    const myTasks = myAssignedTasksCount[0]?.value ?? 0;
    const lastImport = latestImport[0] ?? null;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {actor.systemRole === "SUPER_ADMIN"
                            ? "System Governance Cockpit"
                            : actor.systemRole === "EXECUTIVE"
                              ? "Executive Operations Cockpit"
                              : "Officer Operations Cockpit"}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Signed in as {actor.fullName} (
                        <span className="font-mono text-foreground">{actor.studentIdNumber}</span>)
                        {activeTerm ? (
                            <>
                                {" "}
                                &middot; Active Term:{" "}
                                <span className="font-mono text-foreground">{activeTerm.code}</span>
                            </>
                        ) : null}
                    </p>
                </div>
                <Link
                    href={ROUTES.workspace.account}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-secondary px-3.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                >
                    <UserCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    <span>Account security</span>
                </Link>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted px-4 py-2.5 text-xs font-medium text-muted-foreground">
                    Live Operational Summary
                </div>
                <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
                    <div className="flex items-center justify-between p-4">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Radio className="size-4 text-success" strokeWidth={1.75} aria-hidden="true" />
                            Open Checkpoints
                        </span>
                        <span className="font-mono text-base font-semibold">{openCheckpoints}</span>
                    </div>

                    {actor.systemRole === "SUPER_ADMIN" ? (
                        <>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <ShieldAlert
                                        className="size-4 text-warning"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Needs Review
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {flaggedUsers}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <Users className="size-4 text-info" strokeWidth={1.75} aria-hidden="true" />
                                    Active Accounts
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {totalActiveUsers}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <FileSpreadsheet
                                        className="size-4 text-muted-foreground"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Last Masterlist
                                </span>
                                <span className="font-mono text-xs font-medium">
                                    {lastImport ? `${lastImport.totalRows} rows` : "None"}
                                </span>
                            </div>
                        </>
                    ) : actor.systemRole === "EXECUTIVE" ? (
                        <>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <CalendarDays
                                        className="size-4 text-warning"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Pending Proposals
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {pendingProposals}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <CalendarDays
                                        className="size-4 text-brand-accent"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Ready to Publish
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {readyToPublish}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <CheckSquare
                                        className="size-4 text-info"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    My Tasks
                                </span>
                                <span className="font-mono text-base font-semibold">{myTasks}</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <CheckSquare
                                        className="size-4 text-info"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Assigned Tasks
                                </span>
                                <span className="font-mono text-base font-semibold">{myTasks}</span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <Crown
                                        className="size-4 text-brand-accent"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Committees Headed
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {myHeadCommittees.length}
                                </span>
                            </div>
                            <div className="flex items-center justify-between p-4">
                                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <CalendarDays
                                        className="size-4 text-warning"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    Pending Review
                                </span>
                                <span className="font-mono text-base font-semibold">
                                    {pendingProposals}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Events &amp; Proposals</CardTitle>
                        <CardDescription>
                            Latest event records scoped to organizational operations (M3 modules
                            upcoming).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {recentEvents.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                No event proposals recorded in the active term yet.
                            </p>
                        ) : (
                            <ul className="divide-y divide-border">
                                {recentEvents.map((ev) => (
                                    <li
                                        key={ev.id}
                                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">{ev.title}</p>
                                            <p className="font-mono text-xs text-muted-foreground">
                                                {ev.startAt.toISOString().slice(0, 10)}
                                            </p>
                                        </div>
                                        <Badge variant="neutral">{ev.status}</Badge>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {actor.systemRole === "EXECUTIVE" || actor.systemRole === "SUPER_ADMIN" ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ScrollText
                                    className="size-4 text-muted-foreground"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                />
                                Recent Audit Trail
                            </CardTitle>
                            <CardDescription>
                                Latest immutable governance events recorded in PostgreSQL.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {recentAudits.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">
                                    No audit entries recorded yet.
                                </p>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {recentAudits.map((entry) => (
                                        <li
                                            key={entry.id}
                                            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                                        >
                                            <span className="truncate font-mono text-xs font-medium">
                                                {entry.action}
                                            </span>
                                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                                {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle>Upcoming Officer Meetings</CardTitle>
                            <CardDescription>
                                Scheduled internal meetings visible exclusively to officers.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {recentMeetings.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">
                                    No upcoming officer meetings scheduled.
                                </p>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {recentMeetings.map((mtg) => (
                                        <li
                                            key={mtg.id}
                                            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">
                                                    {mtg.title}
                                                </p>
                                                <p className="font-mono text-xs text-muted-foreground">
                                                    {mtg.scheduledStartAt
                                                        .toISOString()
                                                        .slice(0, 16)
                                                        .replace("T", " ")}{" "}
                                                    UTC
                                                </p>
                                            </div>
                                            <Badge variant="brand">{mtg.status}</Badge>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
