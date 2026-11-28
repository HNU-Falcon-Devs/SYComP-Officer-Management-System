import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, events } from "@/db/schema";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";
import type { PublicPortalEventDto } from "@/app/api/events/_lib/validation";

export async function GET() {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "event:public:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        // AC-04 & FR-EVT-08: Only PUBLISHED and COMPLETED events with public-only fields
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

        const items: PublicPortalEventDto[] = rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            title: row.title,
            publicSummary: row.publicSummary,
            venue: row.venue,
            targetAudience: row.targetAudience,
            startAt: row.startAt.toISOString(),
            endAt: row.endAt.toISOString(),
            status: row.status as "PUBLISHED" | "COMPLETED",
            academicTerm: {
                code: row.termCode,
                name: row.termName,
            },
        }));

        return apiJson({ items }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
