import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attendanceRecords, users } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import {
    confirmScanSchema,
    isTargetActiveOfficerForTerm,
    loadCheckpointContext,
    validateScanWindowAndParentLock,
    type AttendanceRecordDto,
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

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = confirmScanSchema.parse(body);

        const ctx = await loadCheckpointContext(db, input.checkpointId);
        if (!ctx) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "attendance:scan",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const [target] = await db
            .select({
                id: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
                accountStatus: users.accountStatus,
            })
            .from(users)
            .where(sql`lower(${users.studentIdNumber}) = ${input.studentIdNumber.toLowerCase()}`)
            .limit(1);

        if (!target) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "attendance:scan",
                {
                    termStatus: ctx.term.status,
                    eventStatus: ctx.event?.status,
                    meetingStatus: ctx.meeting?.status,
                    academicTermId: ctx.term.id,
                },
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "STUDENT_NOT_FOUND", "Student ID not found in active masterlist.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "attendance:scan",
            {
                termStatus: ctx.term.status,
                eventStatus: ctx.event?.status,
                meetingStatus: ctx.meeting?.status,
                academicTermId: ctx.term.id,
                targetUserId: target.id,
                targetSystemRole: target.systemRole,
                targetAccountStatus: target.accountStatus,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const windowCheck = validateScanWindowAndParentLock(ctx, actor.systemRole);
        if (!windowCheck.ok) {
            return apiError(windowCheck.status, windowCheck.code, windowCheck.message);
        }

        const targetIsOfficer = await isTargetActiveOfficerForTerm(db, target, ctx.term.id);

        if (
            actor.systemRole === "OFFICER" &&
            (target.id === actor.id ||
                targetIsOfficer ||
                ctx.checkpoint.audienceScope === "OFFICERS_ONLY")
        ) {
            return apiError(
                403,
                "OFFICER_SCAN_RESTRICTED",
                "Regular officers cannot scan active Officers or Executives (BR-ATT-05).",
            );
        }

        if (ctx.checkpoint.audienceScope === "OFFICERS_ONLY" && !targetIsOfficer) {
            return apiError(
                400,
                "AUDIENCE_MISMATCH",
                "Checkpoint is restricted to active Officers and Executives.",
            );
        }

        if (ctx.checkpoint.audienceScope === "GENERAL_MEMBERS" && targetIsOfficer) {
            return apiError(
                400,
                "AUDIENCE_MISMATCH",
                "Checkpoint is restricted to General Members.",
            );
        }

        const now = new Date();
        const ip = getClientIp(request);

        try {
            const created = await db.transaction(async (tx) => {
                const [inserted] = await tx
                    .insert(attendanceRecords)
                    .values({
                        checkpointId: ctx.checkpoint.id,
                        userId: target.id,
                        status: "PRESENT",
                        recordedVia: "QR_SCAN",
                        recordedBy: actor.id,
                        recordedAt: now,
                    })
                    .returning();

                if (isBreakGlass) {
                    await writeAuditLog(tx, {
                        actorId: actor.id,
                        action: "ATTENDANCE_SCAN_BREAK_GLASS",
                        entityType: "attendance_record",
                        entityId: inserted.id,
                        beforeState: null,
                        afterState: {
                            checkpointId: ctx.checkpoint.id,
                            userId: target.id,
                            status: inserted.status,
                            recordedVia: inserted.recordedVia,
                        },
                        reason,
                        ipAddress: ip,
                        breakGlass: true,
                    });
                }

                return inserted;
            });

            const dto: AttendanceRecordDto = {
                id: created.id,
                checkpointId: created.checkpointId,
                checkpointLabel: ctx.checkpoint.label,
                userId: target.id,
                studentIdNumber: target.studentIdNumber,
                fullName: target.fullName,
                systemRole: target.systemRole,
                status: created.status,
                recordedVia: created.recordedVia,
                recordedAt: created.recordedAt.toISOString(),
                recordedBy: {
                    id: actor.id,
                    studentIdNumber: actor.studentIdNumber,
                    fullName: actor.fullName,
                },
                lastEditedBy: null,
                lastEditedAt: null,
                editReason: null,
            };

            return apiJson({ record: dto }, 201, { "Cache-Control": "no-store" });
        } catch (err) {
            if (isPgUniqueViolation(err)) {
                const [existing] = await db
                    .select({
                        id: attendanceRecords.id,
                        status: attendanceRecords.status,
                        recordedAt: attendanceRecords.recordedAt,
                        recordedVia: attendanceRecords.recordedVia,
                    })
                    .from(attendanceRecords)
                    .where(
                        and(
                            eq(attendanceRecords.checkpointId, ctx.checkpoint.id),
                            eq(attendanceRecords.userId, target.id),
                        ),
                    )
                    .limit(1);

                return apiError(
                    409,
                    "ALREADY_LOGGED",
                    "Attendance has already been recorded for this checkpoint.",
                    existing
                        ? {
                              existingRecord: {
                                  id: existing.id,
                                  status: existing.status,
                                  recordedAt: existing.recordedAt.toISOString(),
                                  recordedVia: existing.recordedVia,
                              },
                          }
                        : undefined,
                );
            }
            throw err;
        }
    } catch (error) {
        return apiErrorResponse(error);
    }
}
