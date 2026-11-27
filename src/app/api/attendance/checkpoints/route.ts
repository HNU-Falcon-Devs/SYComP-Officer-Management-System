import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendanceCheckpoints, attendanceRecords } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import {
    CHECKPOINT_STATUSES,
    createCheckpointSchema,
    loadCheckpointsWithCounts,
    loadOpenScannerCheckpoints,
    resolveParentContext,
    toCheckpointDto,
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

const listQuerySchema = z.object({
    eventId: z.string().uuid("Invalid event ID.").optional(),
    meetingId: z.string().uuid("Invalid meeting ID.").optional(),
    status: z.enum(CHECKPOINT_STATUSES).optional(),
    forScanner: z.enum(["true", "false"]).optional(),
});

const PRE_APPROVAL_EVENT_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "NEEDS_REVISION"]);

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "attendance:export",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const query = listQuerySchema.parse({
            eventId: url.searchParams.get("eventId") || undefined,
            meetingId: url.searchParams.get("meetingId") || undefined,
            status: url.searchParams.get("status") || undefined,
            forScanner: url.searchParams.get("forScanner") || undefined,
        });

        const checkpoints =
            query.forScanner === "true"
                ? await loadOpenScannerCheckpoints(db, actor.systemRole)
                : await loadCheckpointsWithCounts(db, {
                      eventId: query.eventId,
                      meetingId: query.meetingId,
                      status: query.status,
                  });

        return apiJson({ checkpoints }, 200, { "Cache-Control": "no-store" });
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
        const input = createCheckpointSchema.parse(body);

        const parent = await resolveParentContext(db, {
            eventId: input.eventId,
            meetingId: input.meetingId,
        });

        if (!parent) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "checkpoint:manage",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "PARENT_NOT_FOUND", "Target event or meeting was not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "checkpoint:manage",
            {
                termStatus: parent.termStatus,
                eventStatus: parent.eventStatus,
                meetingStatus: parent.meetingStatus,
                academicTermId: parent.academicTermId,
            },
            createDrizzleAuthorizeDeps(db),
        );

        if (
            parent.kind === "MEETING" &&
            input.audienceScope &&
            input.audienceScope !== "OFFICERS_ONLY"
        ) {
            return apiError(
                400,
                "INVALID_MEETING_AUDIENCE",
                "Meeting attendance checkpoints must use OFFICERS_ONLY audience scope.",
            );
        }

        if (
            parent.kind === "EVENT" &&
            parent.eventStatus &&
            PRE_APPROVAL_EVENT_STATUSES.has(parent.eventStatus)
        ) {
            return apiError(
                409,
                "EVENT_NOT_APPROVED",
                "Checkpoints can only be configured once an event proposal is APPROVED.",
            );
        }

        const resolvedAudienceScope =
            parent.kind === "MEETING" ? "OFFICERS_ONLY" : (input.audienceScope ?? "ALL");
        const ip = getClientIp(request);

        const created = await db.transaction(async (tx) => {
            const [inserted] = await tx
                .insert(attendanceCheckpoints)
                .values({
                    eventId: input.eventId ?? null,
                    meetingId: input.meetingId ?? null,
                    label: input.label,
                    audienceScope: resolvedAudienceScope,
                    sortOrder: input.sortOrder,
                    opensAt: input.opensAt ? new Date(input.opensAt) : null,
                    closesAt: input.closesAt ? new Date(input.closesAt) : null,
                    status: "SCHEDULED",
                    createdBy: actor.id,
                })
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "CHECKPOINT_CREATED",
                entityType: "attendance_checkpoint",
                entityId: inserted.id,
                beforeState: null,
                afterState: {
                    eventId: inserted.eventId,
                    meetingId: inserted.meetingId,
                    label: inserted.label,
                    audienceScope: inserted.audienceScope,
                    sortOrder: inserted.sortOrder,
                    status: inserted.status,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return inserted;
        });

        const [{ total }] = await db
            .select({ total: count() })
            .from(attendanceRecords)
            .where(eq(attendanceRecords.checkpointId, created.id));

        return apiJson(
            {
                checkpoint: toCheckpointDto(created, {
                    parentKind: parent.kind,
                    parentTitle: parent.parentTitle,
                    termCode: parent.termCode,
                    recordCount: Number(total),
                }),
            },
            201,
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
