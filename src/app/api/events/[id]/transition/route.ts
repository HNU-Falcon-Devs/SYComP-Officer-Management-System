import { and, count, eq } from "drizzle-orm";
import type { Permission } from "@/config/permissions";
import { getDb } from "@/db";
import { attendanceCheckpoints, eventProposalReviews, events } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, AuthorizationError, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import { loadEventDetailByIdOrSlug, loadEventProposalReviews } from "../../_lib/queries";
import {
    ALLOWED_EVENT_TRANSITIONS,
    stripHtmlToPlainText,
    transitionEventSchema,
    type EventProposalDecision,
    type EventTransitionAction,
} from "../../_lib/validation";

function permissionForAction(action: EventTransitionAction): Permission {
    if (action === "SUBMIT" || action === "RESUBMIT") {
        return "event:proposal:edit";
    }
    if (action === "REQUEST_REVISION" || action === "APPROVE" || action === "REJECT") {
        return "event:review:decide";
    }
    return "event:lifecycle:manage";
}

function auditActionForTransition(action: EventTransitionAction): string {
    switch (action) {
        case "SUBMIT":
            return "EVENT_SUBMITTED";
        case "RESUBMIT":
            return "EVENT_RESUBMITTED";
        case "REQUEST_REVISION":
            return "EVENT_REVISION_REQUESTED";
        case "APPROVE":
            return "EVENT_APPROVED";
        case "REJECT":
            return "EVENT_REJECTED";
        case "PUBLISH":
            return "EVENT_PUBLISHED";
        case "UNPUBLISH":
            return "EVENT_UNPUBLISHED";
        case "COMPLETE":
            return "EVENT_COMPLETED";
    }
}

function reviewDecisionForTransition(action: EventTransitionAction): EventProposalDecision | null {
    switch (action) {
        case "REQUEST_REVISION":
            return "REQUEST_REVISION";
        case "APPROVE":
            return "APPROVED";
        case "REJECT":
            return "REJECTED";
        case "UNPUBLISH":
            return "UNPUBLISHED";
        default:
            return null;
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
        const input = transitionEventSchema.parse(body);
        const permission = permissionForAction(input.action);

        const { id } = await context.params;
        const loaded = await loadEventDetailByIdOrSlug(db, id);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                permission,
                {},
                deps,
            );
            return apiError(404, "EVENT_NOT_FOUND", "Event not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            permission,
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
                ownerUserId: loaded.raw.createdBy,
            },
            deps,
        );

        const rule = ALLOWED_EVENT_TRANSITIONS[input.action];
        if (!rule.from.includes(loaded.raw.status)) {
            return apiError(
                409,
                "INVALID_EVENT_TRANSITION",
                `Cannot execute ${input.action} when event status is ${loaded.raw.status}.`,
            );
        }

        const noteText = (input.feedbackNote ?? input.reason ?? "").trim() || null;
        const auditReason = (isBreakGlass ? reason : input.reason?.trim() || noteText) || null;

        if (
            (input.action === "REQUEST_REVISION" ||
                input.action === "REJECT" ||
                input.action === "UNPUBLISH") &&
            (!noteText || noteText.length < 5)
        ) {
            return apiError(
                400,
                "FEEDBACK_NOTE_REQUIRED",
                `${input.action} requires an explanation of at least 5 characters.`,
            );
        }

        if (input.action === "SUBMIT" || input.action === "RESUBMIT") {
            if (
                loaded.raw.title.trim().length < 3 ||
                stripHtmlToPlainText(loaded.raw.descriptionHtml).length === 0
            ) {
                return apiError(
                    400,
                    "PROPOSAL_INCOMPLETE",
                    "Title and proposal description are required before submitting for review.",
                );
            }
        }

        const nextVenue = input.venue !== undefined ? input.venue : loaded.raw.venue;
        const nextPublicSummary =
            input.publicSummary !== undefined ? input.publicSummary : loaded.raw.publicSummary;

        if (input.action === "PUBLISH") {
            if (!nextVenue || !nextVenue.trim()) {
                return apiError(
                    400,
                    "PUBLISH_PRECONDITION_FAILED",
                    "A confirmed venue is required before publishing an event to members.",
                );
            }
            if (!nextPublicSummary || !nextPublicSummary.trim()) {
                return apiError(
                    400,
                    "PUBLISH_PRECONDITION_FAILED",
                    "A public summary is required before publishing an event to members.",
                );
            }
        }

        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(events)
                .where(eq(events.id, loaded.raw.id))
                .limit(1);

            if (!existing) {
                throw new AuthorizationError(409, "EVENT_NOT_FOUND", "Event not found.");
            }
            if (!rule.from.includes(existing.status)) {
                throw new AuthorizationError(
                    409,
                    "INVALID_EVENT_TRANSITION",
                    `Event state changed concurrently; cannot run ${input.action} from ${existing.status}.`,
                );
            }

            if (input.action === "COMPLETE") {
                const [{ openCount }] = await tx
                    .select({ openCount: count() })
                    .from(attendanceCheckpoints)
                    .where(
                        and(
                            eq(attendanceCheckpoints.eventId, existing.id),
                            eq(attendanceCheckpoints.status, "OPEN"),
                        ),
                    );
                if (Number(openCount) > 0) {
                    throw new AuthorizationError(
                        409,
                        "OPEN_CHECKPOINTS_EXIST",
                        "Close all open attendance checkpoints before marking this event COMPLETED.",
                    );
                }
            }

            const nextRevisionCount =
                input.action === "RESUBMIT" ? existing.revisionCount + 1 : existing.revisionCount;
            const nextApprovedBy =
                input.action === "APPROVE" ? actor.id : existing.approvedBy;
            const nextApprovedAt =
                input.action === "APPROVE" ? now : existing.approvedAt;
            const nextPublishedBy =
                input.action === "PUBLISH" ? actor.id : existing.publishedBy;
            const nextPublishedAt =
                input.action === "PUBLISH" ? now : existing.publishedAt;
            const nextCompletedBy =
                input.action === "COMPLETE" ? actor.id : existing.completedBy;
            const nextCompletedAt =
                input.action === "COMPLETE" ? now : existing.completedAt;

            await tx
                .update(events)
                .set({
                    status: rule.to,
                    revisionCount: nextRevisionCount,
                    venue: input.action === "PUBLISH" ? nextVenue : existing.venue,
                    publicSummary:
                        input.action === "PUBLISH" ? nextPublicSummary : existing.publicSummary,
                    approvedBy: nextApprovedBy,
                    approvedAt: nextApprovedAt,
                    publishedBy: nextPublishedBy,
                    publishedAt: nextPublishedAt,
                    completedBy: nextCompletedBy,
                    completedAt: nextCompletedAt,
                    updatedAt: now,
                })
                .where(eq(events.id, existing.id));

            const reviewDecision = reviewDecisionForTransition(input.action);
            if (reviewDecision) {
                await tx.insert(eventProposalReviews).values({
                    eventId: existing.id,
                    reviewerId: actor.id,
                    decisionType: reviewDecision,
                    feedbackNote: noteText,
                    revisionNumber: nextRevisionCount,
                    createdAt: now,
                });
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: auditActionForTransition(input.action),
                entityType: "event",
                entityId: existing.id,
                beforeState: {
                    status: existing.status,
                    revision_count: existing.revisionCount,
                    venue: existing.venue,
                    publicSummary: existing.publicSummary,
                    approvedAt: existing.approvedAt?.toISOString() ?? null,
                    publishedAt: existing.publishedAt?.toISOString() ?? null,
                    completedAt: existing.completedAt?.toISOString() ?? null,
                },
                afterState: {
                    status: rule.to,
                    revision_count: nextRevisionCount,
                    venue: input.action === "PUBLISH" ? nextVenue : existing.venue,
                    publicSummary:
                        input.action === "PUBLISH" ? nextPublicSummary : existing.publicSummary,
                    approvedAt: nextApprovedAt?.toISOString() ?? null,
                    publishedAt: nextPublishedAt?.toISOString() ?? null,
                    completedAt: nextCompletedAt?.toISOString() ?? null,
                },
                reason: auditReason,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const [refreshed, reviews] = await Promise.all([
            loadEventDetailByIdOrSlug(db, loaded.raw.id),
            loadEventProposalReviews(db, loaded.raw.id),
        ]);

        return apiJson(
            {
                event: refreshed?.dto ?? loaded.dto,
                reviews,
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
