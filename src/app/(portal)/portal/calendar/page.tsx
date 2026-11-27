import { inArray } from "drizzle-orm";
import { Archive, Calendar, Globe, MapPin } from "lucide-react";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function PortalCalendarPage() {
    await requireServerAuth("event:public:view");
    const db = getDb();

    const rows = await db
        .select({
            id: events.id,
            title: events.title,
            publicSummary: events.publicSummary,
            venue: events.venue,
            targetAudience: events.targetAudience,
            startAt: events.startAt,
            endAt: events.endAt,
            status: events.status,
        })
        .from(events)
        .where(inArray(events.status, ["PUBLISHED", "COMPLETED"]))
        .orderBy(events.startAt);

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Event Calendar</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Published and archived SYComP events visible to general members.
                </p>
            </div>

            {rows.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Calendar
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            No published events are on the calendar yet.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <ul className="divide-y divide-border">
                        {rows.map((ev) => (
                            <li key={ev.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-base font-semibold">{ev.title}</span>
                                        {ev.status === "PUBLISHED" ? (
                                            <Badge variant="success">
                                                <Globe className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                                PUBLISHED
                                            </Badge>
                                        ) : (
                                            <Badge variant="neutral">
                                                <Archive className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                                COMPLETED
                                            </Badge>
                                        )}
                                    </div>
                                    {ev.publicSummary ? (
                                        <p className="max-w-2xl text-sm text-muted-foreground">
                                            {ev.publicSummary}
                                        </p>
                                    ) : null}
                                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                                        <span className="font-mono">
                                            {ev.startAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                                        </span>
                                        {ev.venue ? (
                                            <span className="inline-flex items-center gap-1">
                                                <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                                {ev.venue}
                                            </span>
                                        ) : null}
                                        {ev.targetAudience ? <span>{ev.targetAudience}</span> : null}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
