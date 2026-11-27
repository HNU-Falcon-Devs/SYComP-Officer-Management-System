import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, meetings } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import {
    loadMeetingDetailById,
    queryMeetingsList,
    sanitizeNullableRichText,
} from "./_lib/queries";
import {
    createMeetingSchema,
    meetingsListQuerySchema,
    parseMeetingsSearchParams,
} from "./_lib/validation";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "meeting:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const query = meetingsListQuerySchema.parse(parseMeetingsSearchParams(url.searchParams));
        const { items, total } = await queryMeetingsList(db, query);

        return apiJson(
            {
                items,
                pagination: {
                    page: query.page,
                    limit: query.limit,
                    total,
                },
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = createMeetingSchema.parse(body);

        const [activeTerm] = await db
            .select({
                id: academicTerms.id,
                status: academicTerms.status,
            })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "meeting:manage",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(
                409,
                "NO_ACTIVE_TERM",
                "An ACTIVE academic term is required before scheduling officer meetings.",
            );
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "meeting:manage",
            {
                termStatus: activeTerm.status,
                academicTermId: activeTerm.id,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const now = new Date();
        const ip = getClientIp(request);
        const sanitizedAgenda = sanitizeNullableRichText(input.agendaHtml);
        const scheduledStartAt = new Date(input.scheduledStartAt);
        const scheduledEndAt = input.scheduledEndAt ? new Date(input.scheduledEndAt) : null;

        const createdId = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(meetings)
                .values({
                    academicTermId: activeTerm.id,
                    title: input.title,
                    scheduledStartAt,
                    scheduledEndAt,
                    locationOrLink: input.locationOrLink ?? null,
                    agendaHtml: sanitizedAgenda,
                    minutesHtml: null,
                    status: "SCHEDULED",
                    createdBy: actor.id,
                    completedAt: null,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: meetings.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "MEETING_CREATED",
                entityType: "meeting",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    academicTermId: activeTerm.id,
                    title: input.title,
                    scheduledStartAt: scheduledStartAt.toISOString(),
                    scheduledEndAt: scheduledEndAt?.toISOString() ?? null,
                    locationOrLink: input.locationOrLink ?? null,
                    status: "SCHEDULED",
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        const loaded = await loadMeetingDetailById(db, createdId);
        return apiJson({ meeting: loaded?.dto }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
