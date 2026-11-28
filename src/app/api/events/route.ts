import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms, events } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
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
import { sanitizeRichText } from "@/lib/security/sanitize";
import {
    generateUniqueEventSlug,
    loadEventDetailByIdOrSlug,
    queryEventsList,
} from "./_lib/queries";
import {
    createEventSchema,
    eventsListQuerySchema,
    parseEventsSearchParams,
    stripHtmlToPlainText,
} from "./_lib/validation";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "event:workspace:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const query = eventsListQuerySchema.parse(parseEventsSearchParams(url.searchParams));
        const { items, total } = await queryEventsList(db, actor, query);

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
        const input = createEventSchema.parse(body);

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
                "event:proposal:create",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(
                409,
                "NO_ACTIVE_TERM",
                "An ACTIVE academic term is required before creating event proposals.",
            );
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "event:proposal:create",
            {
                termStatus: activeTerm.status,
                academicTermId: activeTerm.id,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const sanitizedDescription = sanitizeRichText(input.descriptionHtml);
        if (stripHtmlToPlainText(sanitizedDescription).length === 0) {
            return apiError(
                400,
                "EMPTY_DESCRIPTION",
                "Proposal description must contain readable text after HTML sanitization.",
            );
        }

        const slug = await generateUniqueEventSlug(db, input.title, input.slug);
        const startAt = new Date(input.startAt);
        const endAt = new Date(input.endAt);
        const initialStatus = input.submitImmediately ? "PENDING_REVIEW" : "DRAFT";
        const now = new Date();
        const ip = getClientIp(request);

        const createdId = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(events)
                .values({
                    academicTermId: activeTerm.id,
                    title: input.title,
                    slug,
                    descriptionHtml: sanitizedDescription,
                    publicSummary: input.publicSummary ?? null,
                    venue: input.venue ?? null,
                    targetAudience: input.targetAudience ?? null,
                    startAt,
                    endAt,
                    status: initialStatus,
                    revisionCount: 0,
                    createdBy: actor.id,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: events.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: input.submitImmediately ? "EVENT_SUBMITTED" : "EVENT_PROPOSAL_CREATED",
                entityType: "event",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    academicTermId: activeTerm.id,
                    title: input.title,
                    slug,
                    venue: input.venue ?? null,
                    targetAudience: input.targetAudience ?? null,
                    startAt: startAt.toISOString(),
                    endAt: endAt.toISOString(),
                    status: initialStatus,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        const loaded = await loadEventDetailByIdOrSlug(db, createdId);
        return apiJson({ event: loaded?.dto }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "EVENT_SLUG_CONFLICT",
                "An event with this slug already exists in the active academic term.",
            );
        }
        return apiErrorResponse(error);
    }
}
