import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendanceCheckpoints, attendanceRecords } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import {
    loadCheckpointContext,
    toCheckpointDto,
    updateCheckpointSchema,
} from "@/lib/attendance/validation";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";

const uuidSchema = z.string().uuid("Invalid checkpoint ID.");

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { id } = await context.params;
        const checkpointId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = updateCheckpointSchema.parse(body);

        const ctx = await loadCheckpointContext(db, checkpointId);
        if (!ctx) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "checkpoint:manage",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "checkpoint:manage",
            {
                termStatus: ctx.term.status,
                eventStatus: ctx.event?.status,
                meetingStatus: ctx.meeting?.status,
                academicTermId: ctx.term.id,
            },
            createDrizzleAuthorizeDeps(db),
        );

        if (
            ctx.checkpoint.meetingId !== null &&
            input.audienceScope !== undefined &&
            input.audienceScope !== "OFFICERS_ONLY"
        ) {
            return apiError(
                400,
                "INVALID_MEETING_AUDIENCE",
                "Meeting attendance checkpoints must use OFFICERS_ONLY audience scope.",
            );
        }

        const nextOpensAt =
            input.opensAt === undefined
                ? ctx.checkpoint.opensAt
                : input.opensAt === null
                  ? null
                  : new Date(input.opensAt);
        const nextClosesAt =
            input.closesAt === undefined
                ? ctx.checkpoint.closesAt
                : input.closesAt === null
                  ? null
                  : new Date(input.closesAt);

        if (nextOpensAt && nextClosesAt && nextClosesAt.getTime() < nextOpensAt.getTime()) {
            return apiError(
                400,
                "INVALID_WINDOW",
                "Closing time must be on or after opening time.",
            );
        }

        if (input.status === "OPEN") {
            if (
                ctx.event &&
                ctx.event.status !== "PUBLISHED" &&
                !(ctx.event.status === "COMPLETED" && isBreakGlass)
            ) {
                return apiError(
                    409,
                    "EVENT_NOT_PUBLISHED",
                    "Event checkpoints can only be opened once the event is PUBLISHED.",
                );
            }
            if (
                ctx.meeting &&
                ctx.meeting.status !== "SCHEDULED" &&
                ctx.meeting.status !== "ONGOING" &&
                !(ctx.meeting.status === "COMPLETED" && isBreakGlass)
            ) {
                return apiError(
                    409,
                    "MEETING_NOT_ACTIVE",
                    "Meeting checkpoints can only be opened for SCHEDULED or ONGOING meetings.",
                );
            }
        }

        const now = new Date();
        const ip = getClientIp(request);

        const updated = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(attendanceCheckpoints)
                .where(eq(attendanceCheckpoints.id, checkpointId))
                .limit(1);

            if (!existing) {
                return null;
            }

            const nextLabel = input.label ?? existing.label;
            const nextScope = input.audienceScope ?? existing.audienceScope;
            const nextSort = input.sortOrder ?? existing.sortOrder;
            const nextStatus = input.status ?? existing.status;

            const statusChanged = nextStatus !== existing.status;
            const metaChanged =
                nextLabel !== existing.label ||
                nextScope !== existing.audienceScope ||
                nextSort !== existing.sortOrder ||
                (nextOpensAt?.getTime() ?? null) !== (existing.opensAt?.getTime() ?? null) ||
                (nextClosesAt?.getTime() ?? null) !== (existing.closesAt?.getTime() ?? null);

            if (!statusChanged && !metaChanged) {
                return existing;
            }

            const [saved] = await tx
                .update(attendanceCheckpoints)
                .set({
                    label: nextLabel,
                    audienceScope: nextScope,
                    sortOrder: nextSort,
                    opensAt: nextOpensAt,
                    closesAt: nextClosesAt,
                    status: nextStatus,
                    updatedAt: now,
                })
                .where(eq(attendanceCheckpoints.id, existing.id))
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: statusChanged ? "CHECKPOINT_STATE_CHANGED" : "CHECKPOINT_UPDATED",
                entityType: "attendance_checkpoint",
                entityId: saved.id,
                beforeState: {
                    label: existing.label,
                    audienceScope: existing.audienceScope,
                    sortOrder: existing.sortOrder,
                    opensAt: existing.opensAt?.toISOString() ?? null,
                    closesAt: existing.closesAt?.toISOString() ?? null,
                    status: existing.status,
                },
                afterState: {
                    label: saved.label,
                    audienceScope: saved.audienceScope,
                    sortOrder: saved.sortOrder,
                    opensAt: saved.opensAt?.toISOString() ?? null,
                    closesAt: saved.closesAt?.toISOString() ?? null,
                    status: saved.status,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return saved;
        });

        if (!updated) {
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const [{ total }] = await db
            .select({ total: count() })
            .from(attendanceRecords)
            .where(eq(attendanceRecords.checkpointId, updated.id));

        return apiJson(
            {
                checkpoint: toCheckpointDto(updated, {
                    parentKind: ctx.event ? "EVENT" : "MEETING",
                    parentTitle: ctx.event?.title ?? ctx.meeting?.title ?? "Session",
                    termCode: ctx.term.code,
                    recordCount: Number(total),
                }),
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        if (isPgUniqueViolation(error)) {
            return apiError(
                409,
                "CHECKPOINT_CONFLICT",
                "A checkpoint with that label already exists for this event or meeting.",
            );
        }
        return apiErrorResponse(error);
    }
}
