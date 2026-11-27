import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attendanceRecords, users } from "@/db/schema";
import {
    isTargetActiveOfficerForTerm,
    loadCheckpointContext,
    lookupQuerySchema,
    validateScanWindowAndParentLock,
    type LookupVerificationDto,
} from "@/lib/attendance/validation";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiError, apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

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
        const parsed = lookupQuerySchema.parse({
            checkpointId: url.searchParams.get("checkpointId") || undefined,
            studentId: url.searchParams.get("studentId") || undefined,
        });

        const ctx = await loadCheckpointContext(db, parsed.checkpointId);
        if (!ctx) {
            return apiError(404, "CHECKPOINT_NOT_FOUND", "Attendance checkpoint not found.");
        }

        const windowCheck = validateScanWindowAndParentLock(ctx, actor.systemRole);
        if (!windowCheck.ok) {
            return apiError(windowCheck.status, windowCheck.code, windowCheck.message);
        }

        const checkpointSummary: LookupVerificationDto["checkpoint"] = {
            id: ctx.checkpoint.id,
            label: ctx.checkpoint.label,
            audienceScope: ctx.checkpoint.audienceScope,
            parentKind: ctx.event ? "EVENT" : "MEETING",
            parentTitle: ctx.event?.title ?? ctx.meeting?.title ?? "Session",
        };

        const [target] = await db
            .select({
                id: users.id,
                studentIdNumber: users.studentIdNumber,
                fullName: users.fullName,
                systemRole: users.systemRole,
                accountStatus: users.accountStatus,
            })
            .from(users)
            .where(sql`lower(${users.studentIdNumber}) = ${parsed.studentId.toLowerCase()}`)
            .limit(1);

        if (!target) {
            const payload: LookupVerificationDto = {
                verificationState: "NOT_FOUND",
                message: "Student ID not found in active masterlist.",
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target: null,
                existingRecord: null,
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

        if (target.accountStatus !== "ACTIVE") {
            const payload: LookupVerificationDto = {
                verificationState: "ACCOUNT_HOLD",
                message: `Account is ${target.accountStatus} — Cannot log attendance (BR-ATT-07).`,
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target,
                existingRecord: null,
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

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

        if (existing) {
            const payload: LookupVerificationDto = {
                verificationState: "ALREADY_LOGGED",
                message: "Attendance already recorded for this checkpoint.",
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target,
                existingRecord: {
                    id: existing.id,
                    status: existing.status,
                    recordedAt: existing.recordedAt.toISOString(),
                    recordedVia: existing.recordedVia,
                },
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

        const targetIsOfficer = await isTargetActiveOfficerForTerm(db, target, ctx.term.id);

        if (
            actor.systemRole === "OFFICER" &&
            (target.id === actor.id ||
                targetIsOfficer ||
                ctx.checkpoint.audienceScope === "OFFICERS_ONLY")
        ) {
            const payload: LookupVerificationDto = {
                verificationState: "OFFICER_RESTRICTED",
                message: "Officer attendance must be recorded by an Executive (BR-ATT-05).",
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target,
                existingRecord: null,
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

        if (ctx.checkpoint.audienceScope === "OFFICERS_ONLY" && !targetIsOfficer) {
            const payload: LookupVerificationDto = {
                verificationState: "AUDIENCE_MISMATCH",
                message: "Checkpoint is restricted to active Officers and Executives.",
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target,
                existingRecord: null,
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

        if (ctx.checkpoint.audienceScope === "GENERAL_MEMBERS" && targetIsOfficer) {
            const payload: LookupVerificationDto = {
                verificationState: "AUDIENCE_MISMATCH",
                message: "Checkpoint is restricted to General Members.",
                requiresBreakGlass: false,
                checkpoint: checkpointSummary,
                target,
                existingRecord: null,
            };
            return apiJson(payload, 200, { "Cache-Control": "no-store" });
        }

        const payload: LookupVerificationDto = {
            verificationState: "READY",
            message: "Ready to confirm attendance.",
            requiresBreakGlass: actor.systemRole === "SUPER_ADMIN",
            checkpoint: checkpointSummary,
            target,
            existingRecord: null,
        };
        return apiJson(payload, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
