import { getDb } from "@/db";
import { eventCommittees } from "@/db/schema";
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
    loadEligibleOfficersForTerm,
    loadEventCommittees,
    loadEventDetailByIdOrSlug,
} from "../../_lib/queries";
import { COMMITTEE_ELIGIBLE_EVENT_STATUSES, createCommitteeSchema } from "../../_lib/validation";

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

        const [committees, eligibleOfficers] = await Promise.all([
            loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId),
            loadEligibleOfficersForTerm(db, loaded.raw.academicTermId),
        ]);

        return apiJson({ committees, eligibleOfficers }, 200, { "Cache-Control": "no-store" });
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
        const input = createCommitteeSchema.parse(body);

        const { id } = await context.params;
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
            },
            deps,
        );

        if (!COMMITTEE_ELIGIBLE_EVENT_STATUSES.has(loaded.raw.status) && !isBreakGlass) {
            return apiError(
                409,
                "EVENT_NOT_APPROVED",
                "Committees can only be created once an event proposal is APPROVED or PUBLISHED (BR-COM-01).",
            );
        }

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

        const now = new Date();
        const ip = getClientIp(request);

        const createdId = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(eventCommittees)
                .values({
                    eventId: loaded.raw.id,
                    name: input.name,
                    description: input.description ?? null,
                    headUserId: input.headUserId,
                    createdBy: actor.id,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning({ id: eventCommittees.id });

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "COMMITTEE_CREATED",
                entityType: "event_committee",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    eventId: loaded.raw.id,
                    name: input.name,
                    description: input.description ?? null,
                    head_user_id: input.headUserId,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted.id;
        });

        const committees = await loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId);
        const created = committees.find((c) => c.id === createdId) ?? null;

        return apiJson({ committee: created, committees }, 201, { "Cache-Control": "no-store" });
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
