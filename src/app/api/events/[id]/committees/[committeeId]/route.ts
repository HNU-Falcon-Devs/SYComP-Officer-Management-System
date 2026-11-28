import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { eventCommitteeMembers, eventCommittees } from "@/db/schema";
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
import {
    isEligibleActiveTermOfficer,
    loadEventCommittees,
    loadEventDetailByIdOrSlug,
} from "../../../_lib/queries";
import { COMMITTEE_ELIGIBLE_EVENT_STATUSES, updateCommitteeSchema } from "../../../_lib/validation";

const uuidSchema = z.string().uuid("Invalid committee ID.");

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string; committeeId: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const deps = createDrizzleAuthorizeDeps(db);

        const { id, committeeId: rawCommitteeId } = await context.params;
        const committeeId = uuidSchema.parse(rawCommitteeId);
        const body = await request.json().catch(() => null);
        const input = updateCommitteeSchema.parse(body);

        const loaded = await loadEventDetailByIdOrSlug(db, id);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "committee:manage",
                {},
                deps,
            );
            return apiError(404, "EVENT_NOT_FOUND", "Event not found.");
        }

        const [existing] = await db
            .select()
            .from(eventCommittees)
            .where(
                and(
                    eq(eventCommittees.id, committeeId),
                    eq(eventCommittees.eventId, loaded.raw.id),
                ),
            )
            .limit(1);

        if (!existing) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "committee:manage",
                {
                    termStatus: loaded.termStatus,
                    eventStatus: loaded.raw.status,
                    academicTermId: loaded.raw.academicTermId,
                    eventId: loaded.raw.id,
                },
                deps,
            );
            return apiError(404, "COMMITTEE_NOT_FOUND", "Event committee not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "committee:manage",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
                committeeId: existing.id,
            },
            deps,
        );

        if (!COMMITTEE_ELIGIBLE_EVENT_STATUSES.has(loaded.raw.status) && !isBreakGlass) {
            return apiError(
                409,
                "EVENT_NOT_APPROVED",
                "Committees can only be modified while an event is APPROVED or PUBLISHED.",
            );
        }

        if (input.headUserId !== undefined && input.headUserId !== existing.headUserId) {
            const headCheck = await isEligibleActiveTermOfficer(
                db,
                input.headUserId,
                loaded.raw.academicTermId,
            );
            if (!headCheck.eligible) {
                return apiError(
                    400,
                    "INVALID_COMMITTEE_HEAD",
                    headCheck.reason ?? "Committee Head must be an active Officer or Executive.",
                );
            }
        }

        const nextName = input.name ?? existing.name;
        const nextDescription =
            input.description === undefined ? existing.description : input.description;
        const nextHeadUserId = input.headUserId ?? existing.headUserId;
        const headChanged = nextHeadUserId !== existing.headUserId;

        if (
            nextName === existing.name &&
            nextDescription === existing.description &&
            !headChanged
        ) {
            const committees = await loadEventCommittees(
                db,
                loaded.raw.id,
                loaded.raw.academicTermId,
            );
            return apiJson(
                { committee: committees.find((c) => c.id === existing.id) ?? null, committees },
                200,
                { "Cache-Control": "no-store" },
            );
        }

        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            await tx
                .update(eventCommittees)
                .set({
                    name: nextName,
                    description: nextDescription,
                    headUserId: nextHeadUserId,
                    updatedAt: now,
                })
                .where(eq(eventCommittees.id, existing.id));

            // BR-COM-04: New head must not remain duplicated inside committee members roster
            if (headChanged) {
                await tx
                    .delete(eventCommitteeMembers)
                    .where(
                        and(
                            eq(eventCommitteeMembers.committeeId, existing.id),
                            eq(eventCommitteeMembers.userId, nextHeadUserId),
                        ),
                    );
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: headChanged ? "COMMITTEE_HEAD_ASSIGNED" : "COMMITTEE_UPDATED",
                entityType: "event_committee",
                entityId: existing.id,
                beforeState: {
                    name: existing.name,
                    description: existing.description,
                    head_user_id: existing.headUserId,
                },
                afterState: {
                    name: nextName,
                    description: nextDescription,
                    head_user_id: nextHeadUserId,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const committees = await loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId);
        return apiJson(
            { committee: committees.find((c) => c.id === existing.id) ?? null, committees },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "COMMITTEE_NAME_CONFLICT",
                "A committee with this name already exists for this event.",
            );
        }
        return apiErrorResponse(error);
    }
}
