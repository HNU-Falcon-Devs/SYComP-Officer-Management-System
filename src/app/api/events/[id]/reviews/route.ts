import { getDb } from "@/db";
import { eventProposalReviews } from "@/db/schema";
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
import { loadEventDetailByIdOrSlug, loadEventProposalReviews } from "../../_lib/queries";
import { createReviewCommentSchema } from "../../_lib/validation";

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        await authorize({ actor: session?.user ?? null }, "event:workspace:view", {}, deps);

        const { id } = await context.params;
        const loaded = await loadEventDetailByIdOrSlug(db, id);
        if (!loaded) {
            return apiError(404, "EVENT_NOT_FOUND", "Event not found.");
        }

        if (loaded.raw.status === "DRAFT") {
            await authorize(
                { actor: session?.user ?? null },
                "event:draft:view",
                { ownerUserId: loaded.raw.createdBy, eventId: loaded.raw.id },
                deps,
            );
        }

        const reviews = await loadEventProposalReviews(db, loaded.raw.id);
        return apiJson({ reviews }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        const body = await request.json().catch(() => null);
        const input = createReviewCommentSchema.parse(body);

        const { id } = await context.params;
        const loaded = await loadEventDetailByIdOrSlug(db, id);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "event:review:comment",
                {},
                deps,
            );
            return apiError(404, "EVENT_NOT_FOUND", "Event not found.");
        }

        if (loaded.raw.status === "DRAFT") {
            await authorize(
                { actor: session?.user ?? null },
                "event:draft:view",
                { ownerUserId: loaded.raw.createdBy, eventId: loaded.raw.id },
                deps,
            );
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "event:review:comment",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
            },
            deps,
        );

        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(eventProposalReviews)
                .values({
                    eventId: loaded.raw.id,
                    reviewerId: actor.id,
                    decisionType: "COMMENT",
                    feedbackNote: input.feedbackNote,
                    revisionNumber: loaded.raw.revisionCount,
                    createdAt: now,
                })
                .returning({ id: eventProposalReviews.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "EVENT_REVIEW_COMMENTED",
                entityType: "event_proposal_review",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    eventId: loaded.raw.id,
                    decisionType: "COMMENT",
                    revisionNumber: loaded.raw.revisionCount,
                },
                reason: isBreakGlass ? reason : null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const reviews = await loadEventProposalReviews(db, loaded.raw.id);
        return apiJson({ reviews }, 201, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
