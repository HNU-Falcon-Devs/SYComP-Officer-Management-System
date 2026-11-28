import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attendanceRecords, users } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import {
    isTargetActiveOfficerForTerm,
    loadCheckpointContext,
    manualOverrideCreateSchema,
    manualOverridePatchSchema,
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
        const input = manualOverrideCreateSchema.parse(body);

        const ctx = await loadCheckpointContext(db, input.checkpointId);
        if (!ctx) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.editReason },
                "attendance:override",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const { actor, isBreakGlass } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.editReason,
            },
            "attendance:override",
            {
                termStatus: ctx.term.status,
                eventStatus: ctx.event?.status,
                meetingStatus: ctx.meeting?.status,
                academicTermId: ctx.term.id,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const [target] = await db
            .select({
                id: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
            })
            .from(users)
            .where(sql`lower(${users.studentIdNumber}) = ${input.studentIdNumber.toLowerCase()}`)
            .limit(1);

        if (!target) {
            return apiError(404, "STUDENT_NOT_FOUND", "Student ID not found in active masterlist.");
        }

        const targetIsOfficer = await isTargetActiveOfficerForTerm(db, target, ctx.term.id);
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
                        status: input.status,
                        recordedVia: "MANUAL_EXECUTIVE",
                        recordedBy: actor.id,
                        recordedAt: now,
                        editReason: input.editReason,
                    })
                    .returning();

                await writeAuditLog(tx, {
                    actorId: actor.id,
                    action: "ATTENDANCE_MANUAL_CREATED",
                    entityType: "attendance_record",
                    entityId: inserted.id,
                    beforeState: null,
                    afterState: {
                        checkpointId: ctx.checkpoint.id,
                        userId: target.id,
                        status: inserted.status,
                        recordedVia: inserted.recordedVia,
                    },
                    reason: input.editReason,
                    ipAddress: ip,
                    breakGlass: isBreakGlass,
                });

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
                editReason: created.editReason,
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
                    "An attendance record already exists for this student at this checkpoint. Use PATCH to override it.",
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

export async function PATCH(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const body = await request.json().catch(() => null);
        const input = manualOverridePatchSchema.parse(body);

        const [recordRow] = await db
            .select()
            .from(attendanceRecords)
            .where(eq(attendanceRecords.id, input.recordId))
            .limit(1);

        if (!recordRow) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.editReason },
                "attendance:override",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "RECORD_NOT_FOUND", "Attendance record not found.");
        }

        const ctx = await loadCheckpointContext(db, recordRow.checkpointId);
        if (!ctx) {
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const { actor, isBreakGlass } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.editReason,
            },
            "attendance:override",
            {
                termStatus: ctx.term.status,
                eventStatus: ctx.event?.status,
                meetingStatus: ctx.meeting?.status,
                academicTermId: ctx.term.id,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const now = new Date();
        const ip = getClientIp(request);

        const updated = await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(attendanceRecords)
                .where(eq(attendanceRecords.id, recordRow.id))
                .limit(1);

            if (!existing) {
                return null;
            }

            const [saved] = await tx
                .update(attendanceRecords)
                .set({
                    status: input.status,
                    lastEditedBy: actor.id,
                    lastEditedAt: now,
                    editReason: input.editReason,
                    updatedAt: now,
                })
                .where(eq(attendanceRecords.id, existing.id))
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "ATTENDANCE_OVERRIDDEN",
                entityType: "attendance_record",
                entityId: saved.id,
                beforeState: {
                    status: existing.status,
                    editReason: existing.editReason,
                },
                afterState: {
                    checkpointId: existing.checkpointId,
                    userId: existing.userId,
                    status: saved.status,
                    editReason: saved.editReason,
                },
                reason: input.editReason,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });

            return saved;
        });

        if (!updated) {
            return apiError(404, "RECORD_NOT_FOUND", "Attendance record not found.");
        }

        const actorIds = Array.from(
            new Set([updated.userId, updated.recordedBy, updated.lastEditedBy].filter(Boolean) as string[]),
        );
        const userRows = await db
            .select({
                id: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
            })
            .from(users)
            .where(inArray(users.id, actorIds));
        const userMap = new Map(userRows.map((u) => [u.id, u]));
        const subject = userMap.get(updated.userId);
        const recorder = userMap.get(updated.recordedBy);
        const editor = updated.lastEditedBy ? userMap.get(updated.lastEditedBy) : null;

        const dto: AttendanceRecordDto = {
            id: updated.id,
            checkpointId: updated.checkpointId,
            checkpointLabel: ctx.checkpoint.label,
            userId: updated.userId,
            studentIdNumber: subject?.studentIdNumber ?? "",
            fullName: subject?.fullName ?? "",
            systemRole: subject?.systemRole ?? "MEMBER",
            status: updated.status,
            recordedVia: updated.recordedVia,
            recordedAt: updated.recordedAt.toISOString(),
            recordedBy: recorder
                ? {
                      id: recorder.id,
                      studentIdNumber: recorder.studentIdNumber,
                      fullName: recorder.fullName,
                  }
                : null,
            lastEditedBy: editor
                ? {
                      id: editor.id,
                      studentIdNumber: editor.studentIdNumber,
                      fullName: editor.fullName,
                  }
                : null,
            lastEditedAt: updated.lastEditedAt ? updated.lastEditedAt.toISOString() : null,
            editReason: updated.editReason,
        };

        return apiJson({ record: dto }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
