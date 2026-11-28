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
} from "../../../../_lib/queries";
import {
    COMMITTEE_ELIGIBLE_EVENT_STATUSES,
    committeeMemberMutationSchema,
} from "../../../../_lib/validation";

const uuidSchema = z.string().uuid("Invalid committee ID.");

async function resolveEventAndCommittee(
    db: ReturnType<typeof getDb>,
    idOrSlug: string,
    committeeId: string,
) {
    const loaded = await loadEventDetailByIdOrSlug(db, idOrSlug);
    if (!loaded) {
        return { loaded: null, committee: null };
    }
    const [committee] = await db
        .select()
        .from(eventCommittees)
        .where(
            and(
                eq(eventCommittees.id, committeeId),
                eq(eventCommittees.eventId, loaded.raw.id),
            ),
        )
        .limit(1);
    return { loaded, committee: committee ?? null };
}

export async function POST(
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
        const input = committeeMemberMutationSchema.parse(body);

        const { loaded, committee } = await resolveEventAndCommittee(db, id, committeeId);
        if (!loaded || !committee) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "committee:members:manage",
                {},
                deps,
            );
            return apiError(404, "COMMITTEE_NOT_FOUND", "Event or committee not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "committee:members:manage",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
                committeeId: committee.id,
            },
            deps,
        );

        if (!COMMITTEE_ELIGIBLE_EVENT_STATUSES.has(loaded.raw.status) && !isBreakGlass) {
            return apiError(
                409,
                "EVENT_NOT_APPROVED",
                "Committee rosters can only be modified while an event is APPROVED or PUBLISHED.",
            );
        }

        if (input.userId === committee.headUserId) {
            return apiError(
                400,
                "HEAD_CANNOT_BE_MEMBER",
                "The Committee Head is already assigned to lead this committee and cannot be added as a member (BR-COM-04).",
            );
        }

        const memberCheck = await isEligibleActiveTermOfficer(
            db,
            input.userId,
            loaded.raw.academicTermId,
        );
        if (!memberCheck.eligible) {
            return apiError(
                400,
                "INVALID_COMMITTEE_MEMBER",
                memberCheck.reason ?? "Committee members must be active Officers or Executives.",
            );
        }

        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            await tx.insert(eventCommitteeMembers).values({
                committeeId: committee.id,
                userId: input.userId,
                addedBy: actor.id,
                addedAt: now,
            });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "COMMITTEE_MEMBER_ADDED",
                entityType: "event_committee",
                entityId: committee.id,
                beforeState: null,
                afterState: {
                    eventId: loaded.raw.id,
                    committeeId: committee.id,
                    userId: input.userId,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const committees = await loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId);
        return apiJson(
            { committee: committees.find((c) => c.id === committee.id) ?? null, committees },
            201,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "COMMITTEE_MEMBER_EXISTS",
                "Officer is already a member of this committee.",
            );
        }
        return apiErrorResponse(error);
    }
}

export async function DELETE(
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
        const input = committeeMemberMutationSchema.parse(body);

        const { loaded, committee } = await resolveEventAndCommittee(db, id, committeeId);
        if (!loaded || !committee) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "committee:members:manage",
                {},
                deps,
            );
            return apiError(404, "COMMITTEE_NOT_FOUND", "Event or committee not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "committee:members:manage",
            {
                termStatus: loaded.termStatus,
                eventStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
                eventId: loaded.raw.id,
                committeeId: committee.id,
            },
            deps,
        );

        const ip = getClientIp(request);

        const removed = await db.transaction(async (tx) => {
            const deleted = await tx
                .delete(eventCommitteeMembers)
                .where(
                    and(
                        eq(eventCommitteeMembers.committeeId, committee.id),
                        eq(eventCommitteeMembers.userId, input.userId),
                    ),
                )
                .returning({ userId: eventCommitteeMembers.userId });

            if (deleted.length === 0) {
                return false;
            }

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "COMMITTEE_MEMBER_REMOVED",
                entityType: "event_committee",
                entityId: committee.id,
                beforeState: {
                    eventId: loaded.raw.id,
                    committeeId: committee.id,
                    userId: input.userId,
                },
                afterState: null,
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return true;
        });

        if (!removed) {
            return apiError(404, "COMMITTEE_MEMBER_NOT_FOUND", "Member is not on this committee.");
        }

        const committees = await loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId);
        return apiJson(
            { committee: committees.find((c) => c.id === committee.id) ?? null, committees },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
