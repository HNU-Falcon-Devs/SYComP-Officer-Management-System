import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight, Calendar, ClipboardCheck, Globe, Megaphone, Pin } from "lucide-react";
import { ROUTES } from "@/config/routes";
import { getDb } from "@/db";
import { academicTerms, announcements, attendanceRecords, events } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PortalHomePage() {
    const { actor } = await requireServerAuth("event:public:view");
    const db = getDb();

    const [activeTerms, upcomingEvents, recentNotices, myAttendance] = await Promise.all([
        db
            .select({ code: academicTerms.code, name: academicTerms.name })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1),
        db
            .select({
                id: events.id,
                title: events.title,
                venue: events.venue,
                startAt: events.startAt,
                status: events.status,
            })
            .from(events)
            .where(eq(events.status, "PUBLISHED"))
            .orderBy(events.startAt)
            .limit(3),
        db
            .select({
                id: announcements.id,
                title: announcements.title,
                isPinned: announcements.isPinned,
                publishedAt: announcements.publishedAt,
            })
            .from(announcements)
            .where(
                and(
                    eq(announcements.status, "PUBLISHED"),
                    eq(announcements.audience, "ALL_MEMBERS"),
                ),
            )
            .orderBy(desc(announcements.isPinned), desc(announcements.publishedAt))
            .limit(3),
        db
            .select({ id: attendanceRecords.id, status: attendanceRecords.status })
            .from(attendanceRecords)
            .where(
                and(
                    eq(attendanceRecords.userId, actor.id),
                    inArray(attendanceRecords.status, ["PRESENT", "LATE", "EXCUSED"]),
                ),
            ),
    ]);

    const activeTerm = activeTerms[0] ?? null;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Welcome, {actor.fullName}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Read-only member overview for{" "}
                        <span className="font-mono text-foreground">{actor.studentIdNumber}</span>
                        {activeTerm ? (
                            <>
                                {" "}
                                &middot;{" "}
                                <span className="font-mono text-foreground">{activeTerm.code}</span>
                            </>
                        ) : null}
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
                <div className="flex items-center gap-3">
                    <ClipboardCheck
                        className="size-5 text-success"
                        strokeWidth={1.75}
                        aria-hidden="true"
                    />
                    <div>
                        <p className="text-sm font-medium">Recorded Checkpoints</p>
                        <p className="text-xs text-muted-foreground">
                            Verified attendance logs on file across SYComP events
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="font-mono text-lg font-semibold">{myAttendance.length}</span>
                    <Link
                        href={ROUTES.portal.attendance}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                    >
                        <span>View history</span>
                        <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    </Link>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Upcoming Published Events</CardTitle>
                            <CardDescription>Official SYComP calendar entries</CardDescription>
                        </div>
                        <Link
                            href={ROUTES.portal.calendar}
                            className="text-xs font-medium text-primary hover:underline dark:text-brand-accent"
                        >
                            Calendar
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {upcomingEvents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                                <Calendar
                                    className="size-10 text-muted-foreground"
                                    strokeWidth={1.5}
                                    aria-hidden="true"
                                />
                                <p className="text-sm text-muted-foreground">
                                    No published events scheduled yet.
                                </p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-border">
                                {upcomingEvents.map((item) => (
                                    <li key={item.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">{item.title}</p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                <span className="font-mono">
                                                    {item.startAt.toISOString().slice(0, 10)}
                                                </span>
                                                {item.venue ? ` · ${item.venue}` : ""}
                                            </p>
                                        </div>
                                        <Badge variant="success">
                                            <Globe className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                            PUBLISHED
                                        </Badge>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Latest Announcements</CardTitle>
                            <CardDescription>Official member advisories</CardDescription>
                        </div>
                        <Link
                            href={ROUTES.portal.announcements}
                            className="text-xs font-medium text-primary hover:underline dark:text-brand-accent"
                        >
                            All notices
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {recentNotices.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                                <Megaphone
                                    className="size-10 text-muted-foreground"
                                    strokeWidth={1.5}
                                    aria-hidden="true"
                                />
                                <p className="text-sm text-muted-foreground">
                                    No published announcements yet.
                                </p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-border">
                                {recentNotices.map((notice) => (
                                    <li key={notice.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">{notice.title}</p>
                                            {notice.publishedAt ? (
                                                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                                    {notice.publishedAt.toISOString().slice(0, 10)}
                                                </p>
                                            ) : null}
                                        </div>
                                        {notice.isPinned ? (
                                            <Badge variant="brand">
                                                <Pin className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                                Pinned
                                            </Badge>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
