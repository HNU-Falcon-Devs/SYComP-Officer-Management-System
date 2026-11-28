import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, events } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import type { PublicPortalEventDto } from "@/app/api/events/_lib/validation";
import { PortalCalendarView } from "./_components/portal-calendar-view";

export default async function PortalCalendarPage() {
    await requireServerAuth("event:public:view");
    const db = getDb();

    const rows = await db
        .select({
            id: events.id,
            slug: events.slug,
            title: events.title,
            publicSummary: events.publicSummary,
            venue: events.venue,
            targetAudience: events.targetAudience,
            startAt: events.startAt,
            endAt: events.endAt,
            status: events.status,
            termCode: academicTerms.code,
            termName: academicTerms.name,
        })
        .from(events)
        .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
        .where(inArray(events.status, ["PUBLISHED", "COMPLETED"]))
        .orderBy(asc(events.startAt));

    const publicEvents: PublicPortalEventDto[] = rows.map((ev) => ({
        id: ev.id,
        slug: ev.slug,
        title: ev.title,
        publicSummary: ev.publicSummary,
        venue: ev.venue,
        targetAudience: ev.targetAudience,
        startAt: ev.startAt.toISOString(),
        endAt: ev.endAt.toISOString(),
        status: ev.status as "PUBLISHED" | "COMPLETED",
        academicTerm: {
            code: ev.termCode,
            name: ev.termName,
        },
    }));

    return <PortalCalendarView events={publicEvents} />;
}
