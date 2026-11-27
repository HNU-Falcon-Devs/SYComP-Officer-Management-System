import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendanceCheckpoints, meetings } from "@/db/schema";
import { loadCheckpointsWithCounts } from "@/lib/attendance/validation";
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
import { queryDocumentsList } from "@/lib/drive/queries";
import { loadMeetingDetailById, sanitizeNullableRichText } from "../_lib/queries";
import {
    ALLOWED_MEETING_TRANSITIONS,
    updateMeetingSchema,
    type MeetingStatus,
} from "../_lib/validation";

const uuidSchema = z.string().uuid("Invalid meeting ID.");

function resolveMeetingPatchAuditAction(
    fromStatus: MeetingStatus,
    toStatus: MeetingStatus,
): string {
    if (fromStatus !== toStatus) {
        if (toStatus === "ONGOING") return "MEETING_STARTED";
        if (toStatus === "COMPLETED") return "MEETING_COMPLETED";
        if (toStatus === "CANCELLED") return "MEETING_CANCELLED";
    }
    return "MEETING_UPDATED";
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "meeting:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const meetingId = uuidSchema.parse(id);

        const loaded = await loadMeetingDetailById(db, meetingId);
        if (!loaded) {
            return apiError(404, "MEETING_NOT_FOUND", "Officer meeting not found.");
        }

        const [checkpoints, docsResult] = await Promise.all([
            loadCheckpointsWithCounts(db, { meetingId }),
            queryDocumentsList(db, { meetingId, page: 1, limit: 50 }),
        ]);

        return apiJson(
            {
                meeting: loaded.dto,
                checkpoints,
                documents: docsResult.items,
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
        const { id } = await context.params;
        const meetingId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = updateMeetingSchema.parse(body);

        const loaded = await loadMeetingDetailById(db, meetingId);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "meeting:manage",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "MEETING_NOT_FOUND", "Officer meeting not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "meeting:manage",
            {
                termStatus: loaded.termStatus,
                meetingStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const nextStart =
            input.scheduledStartAt !== undefined
                ? new Date(input.scheduledStartAt)
                : loaded.raw.scheduledStartAt;
        const nextEnd =
            input.scheduledEndAt === undefined
                ? loaded.raw.scheduledEndAt
                : input.scheduledEndAt === null
                  ? null
                  : new Date(input.scheduledEndAt);

        if (nextEnd && nextEnd.getTime() < nextStart.getTime()) {
            return apiError(
                400,
                "INVALID_SCHEDULE_RANGE",
                "Scheduled end time must be on or after start time.",
            );
        }

        const currentStatus = loaded.raw.status;
        const nextStatus = input.status ?? currentStatus;

        if (
            nextStatus !== currentStatus &&
            !ALLOWED_MEETING_TRANSITIONS[currentStatus].includes(nextStatus)
        ) {
            return apiError(
                409,
                "INVALID_MEETING_TRANSITION",
                `Cannot transition meeting from ${currentStatus} to ${nextStatus}.`,
            );
        }

        const effectiveReason = (isBreakGlass ? reason : input.reason?.trim()) || null;
        if (nextStatus === "CANCELLED" && currentStatus !== "CANCELLED") {
            const minLen = isBreakGlass ? 10 : 5;
            if (!effectiveReason || effectiveReason.length < minLen) {
                return apiError(
                    400,
                    "CANCELLATION_REASON_REQUIRED",
                    `Cancelling a meeting requires a reason of at least ${minLen} characters.`,
                );
            }
        }

        const sanitizedAgenda =
            input.agendaHtml === undefined
                ? undefined
                : sanitizeNullableRichText(input.agendaHtml);

        const now = new Date();
        const ip = getClientIp(request);

        const outcome = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(meetings)
                .where(eq(meetings.id, meetingId))
                .limit(1);

            if (!existing) {
                return { kind: "not_found" as const };
            }

            if (
                nextStatus !== existing.status &&
                !ALLOWED_MEETING_TRANSITIONS[existing.status].includes(nextStatus)
            ) {
                return { kind: "invalid_transition" as const };
            }

            if (nextStatus === "COMPLETED" && existing.status !== "COMPLETED") {
                const [{ openCount }] = await tx
                    .select({ openCount: count() })
                    .from(attendanceCheckpoints)
                    .where(
                        and(
                            eq(attendanceCheckpoints.meetingId, existing.id),
                            eq(attendanceCheckpoints.status, "OPEN"),
                        ),
                    );
                if (Number(openCount) > 0) {
                    throw new AuthorizationError(
                        409,
                        "OPEN_CHECKPOINTS_EXIST",
                        "Close all open meeting attendance checkpoints before marking the meeting completed.",
                    );
                }
            }

            const resolvedTitle = input.title ?? existing.title;
            const resolvedLocation =
                input.locationOrLink === undefined
                    ? existing.locationOrLink
                    : input.locationOrLink;
            const resolvedAgenda =
                sanitizedAgenda === undefined ? existing.agendaHtml : sanitizedAgenda;
            const resolvedCompletedAt =
                nextStatus === "COMPLETED" ? (existing.completedAt ?? now) : existing.completedAt;

            const changed =
                resolvedTitle !== existing.title ||
                nextStart.getTime() !== existing.scheduledStartAt.getTime() ||
                (nextEnd?.getTime() ?? null) !== (existing.scheduledEndAt?.getTime() ?? null) ||
                resolvedLocation !== existing.locationOrLink ||
                resolvedAgenda !== existing.agendaHtml ||
                nextStatus !== existing.status;

            if (!changed) {
                return { kind: "unchanged" as const };
            }

            const [updated] = await tx
                .update(meetings)
                .set({
                    title: resolvedTitle,
                    scheduledStartAt: nextStart,
                    scheduledEndAt: nextEnd,
                    locationOrLink: resolvedLocation,
                    agendaHtml: resolvedAgenda,
                    status: nextStatus,
                    completedAt: resolvedCompletedAt,
                    updatedAt: now,
                })
                .where(eq(meetings.id, existing.id))
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: resolveMeetingPatchAuditAction(existing.status, updated.status),
                entityType: "meeting",
                entityId: updated.id,
                beforeState: {
                    title: existing.title,
                    scheduledStartAt: existing.scheduledStartAt.toISOString(),
                    scheduledEndAt: existing.scheduledEndAt?.toISOString() ?? null,
                    locationOrLink: existing.locationOrLink,
                    agendaChanged: resolvedAgenda !== existing.agendaHtml ? true : undefined,
                    status: existing.status,
                    completedAt: existing.completedAt?.toISOString() ?? null,
                },
                afterState: {
                    title: updated.title,
                    scheduledStartAt: updated.scheduledStartAt.toISOString(),
                    scheduledEndAt: updated.scheduledEndAt?.toISOString() ?? null,
                    locationOrLink: updated.locationOrLink,
                    agendaChanged: resolvedAgenda !== existing.agendaHtml ? true : undefined,
                    status: updated.status,
                    completedAt: updated.completedAt?.toISOString() ?? null,
                },
                reason: effectiveReason,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return { kind: "updated" as const };
        });

        if (outcome.kind === "not_found") {
            return apiError(404, "MEETING_NOT_FOUND", "Officer meeting not found.");
        }
        if (outcome.kind === "invalid_transition") {
            return apiError(
                409,
                "INVALID_MEETING_TRANSITION",
                "Meeting state transition is no longer valid.",
            );
        }

        const refreshed = await loadMeetingDetailById(db, meetingId);
        return apiJson(
            { meeting: refreshed?.dto ?? loaded.dto },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
