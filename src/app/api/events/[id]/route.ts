import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
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
    loadEventCommittees,
    loadEventDetailByIdOrSlug,
    loadEventProposalReviews,
} from "../_lib/queries";
import { stripHtmlToPlainText, updateEventSchema } from "../_lib/validation";

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        // Enforce base workspace access before leaking 404 vs 403 to unauthorized callers
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
                {
                    ownerUserId: loaded.raw.createdBy,
                    eventId: loaded.raw.id,
                    academicTermId: loaded.raw.academicTermId,
                },
                deps,
            );
        }

        const [reviews, committees] = await Promise.all([
            loadEventProposalReviews(db, loaded.raw.id),
            loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId),
        ]);

        return apiJson(
            {
                event: loaded.dto,
                reviews,
                committees,
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);
        const body = await request.json().catch(() => null);
        const input = updateEventSchema.parse(body);

        const { id } = await context.params;
        const loaded = await loadEventDetailByIdOrSlug(db, id);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "event:workspace:view",
                {},
                deps,
            );
            return apiError(404, "EVENT_NOT_FOUND", "Event not found.");
        }

        const isAuthorEditableState =
            loaded.raw.status === "DRAFT" || loaded.raw.status === "NEEDS_REVISION";

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            isAuthorEditableState ? "event:proposal:edit" : "event:lifecycle:manage",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
                ownerUserId: loaded.raw.createdBy,
            },
            deps,
        );

        const nextStart = input.startAt !== undefined ? new Date(input.startAt) : loaded.raw.startAt;
        const nextEnd = input.endAt !== undefined ? new Date(input.endAt) : loaded.raw.endAt;
        if (nextEnd.getTime() < nextStart.getTime()) {
            return apiError(
                400,
                "INVALID_DATE_RANGE",
                "Event end time must be on or after start time.",
            );
        }

        let nextDescriptionHtml = loaded.raw.descriptionHtml;
        if (input.descriptionHtml !== undefined) {
            nextDescriptionHtml = sanitizeRichText(input.descriptionHtml);
            if (stripHtmlToPlainText(nextDescriptionHtml).length === 0) {
                return apiError(
                    400,
                    "EMPTY_DESCRIPTION",
                    "Proposal description must contain readable text after HTML sanitization.",
                );
            }
        }

        const nextTitle = input.title ?? loaded.raw.title;
        const nextPublicSummary =
            input.publicSummary === undefined ? loaded.raw.publicSummary : input.publicSummary;
        const nextVenue = input.venue === undefined ? loaded.raw.venue : input.venue;
        const nextAudience =
            input.targetAudience === undefined ? loaded.raw.targetAudience : input.targetAudience;

        const changed =
            nextTitle !== loaded.raw.title ||
            nextDescriptionHtml !== loaded.raw.descriptionHtml ||
            nextPublicSummary !== loaded.raw.publicSummary ||
            nextVenue !== loaded.raw.venue ||
            nextAudience !== loaded.raw.targetAudience ||
            nextStart.getTime() !== loaded.raw.startAt.getTime() ||
            nextEnd.getTime() !== loaded.raw.endAt.getTime();

        if (!changed) {
            return apiJson({ event: loaded.dto }, 200, { "Cache-Control": "no-store" });
        }

        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            await tx
                .update(events)
                .set({
                    title: nextTitle,
                    descriptionHtml: nextDescriptionHtml,
                    publicSummary: nextPublicSummary,
                    venue: nextVenue,
                    targetAudience: nextAudience,
                    startAt: nextStart,
                    endAt: nextEnd,
                    updatedAt: now,
                })
                .where(eq(events.id, loaded.raw.id));

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: isAuthorEditableState ? "EVENT_PROPOSAL_UPDATED" : "EVENT_UPDATED",
                entityType: "event",
                entityId: loaded.raw.id,
                beforeState: {
                    title: loaded.raw.title,
                    venue: loaded.raw.venue,
                    targetAudience: loaded.raw.targetAudience,
                    publicSummary: loaded.raw.publicSummary,
                    startAt: loaded.raw.startAt.toISOString(),
                    endAt: loaded.raw.endAt.toISOString(),
                    descriptionChanged:
                        nextDescriptionHtml !== loaded.raw.descriptionHtml ? true : undefined,
                },
                afterState: {
                    title: nextTitle,
                    venue: nextVenue,
                    targetAudience: nextAudience,
                    publicSummary: nextPublicSummary,
                    startAt: nextStart.toISOString(),
                    endAt: nextEnd.toISOString(),
                    descriptionChanged:
                        nextDescriptionHtml !== loaded.raw.descriptionHtml ? true : undefined,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const refreshed = await loadEventDetailByIdOrSlug(db, loaded.raw.id);
        return apiJson({ event: refreshed?.dto ?? loaded.dto }, 200, {
            "Cache-Control": "no-store",
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
