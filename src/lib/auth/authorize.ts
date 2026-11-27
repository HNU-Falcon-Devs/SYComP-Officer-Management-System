import { and, eq } from "drizzle-orm";
import {
    PERMISSIONS,
    type AccountStatus,
    type Permission,
    type SystemRole,
} from "@/config/permissions";
import type { DbExecutor } from "@/db";
import {
    eventCommittees,
    officerAppointments,
    taskAssignees,
    users,
} from "@/db/schema";
import { toSessionActorDto, type SessionActorDto, type UserRecordLike } from "./dto";
import { revokeAllUserSessions } from "./session";

export class AuthorizationError extends Error {
    readonly status: 400 | 401 | 403 | 409;
    readonly code: string;

    constructor(status: 400 | 401 | 403 | 409, code: string, message: string) {
        super(message);
        this.name = "AuthorizationError";
        this.status = status;
        this.code = code;
    }
}

export interface AuthorizeContext {
    actor: UserRecordLike | null | undefined;
    breakGlass?: boolean;
    reason?: string | null;
}

export interface AuthorizeResourceContext {
    termStatus?: "DRAFT" | "ACTIVE" | "CLOSED";
    eventStatus?:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "NEEDS_REVISION"
        | "REJECTED"
        | "APPROVED"
        | "PUBLISHED"
        | "COMPLETED";
    meetingStatus?: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
    academicTermId?: string;
    eventId?: string;
    committeeId?: string | null;
    taskId?: string;
    ownerUserId?: string;
    targetUserId?: string;
    targetSystemRole?: SystemRole;
    targetAccountStatus?: AccountStatus;
}

export interface AuthorizeDeps {
    revokeAllUserSessions?: (userId: string) => Promise<void>;
    hasActiveAppointment?: (userId: string, academicTermId: string) => Promise<boolean>;
    isCommitteeHead?: (userId: string, committeeId: string, academicTermId: string) => Promise<boolean>;
    isTaskAssignee?: (userId: string, taskId: string) => Promise<boolean>;
    isTargetActiveOfficer?: (targetUserId: string, academicTermId?: string) => Promise<boolean>;
}

export interface AuthorizeSuccess {
    actor: SessionActorDto;
    isBreakGlass: boolean;
    reason: string | null;
}

export function createDrizzleAuthorizeDeps(executor: DbExecutor): AuthorizeDeps {
    return {
        revokeAllUserSessions: (userId) => revokeAllUserSessions(executor, userId),

        hasActiveAppointment: async (userId, academicTermId) => {
            const [row] = await executor
                .select({ id: officerAppointments.id })
                .from(officerAppointments)
                .where(
                    and(
                        eq(officerAppointments.userId, userId),
                        eq(officerAppointments.academicTermId, academicTermId),
                        eq(officerAppointments.isCurrent, true),
                    ),
                )
                .limit(1);
            return Boolean(row);
        },

        isCommitteeHead: async (userId, committeeId, academicTermId) => {
            const [committee] = await executor
                .select({ headUserId: eventCommittees.headUserId })
                .from(eventCommittees)
                .where(eq(eventCommittees.id, committeeId))
                .limit(1);
            if (!committee || committee.headUserId !== userId) {
                return false;
            }
            const [appointment] = await executor
                .select({ id: officerAppointments.id })
                .from(officerAppointments)
                .where(
                    and(
                        eq(officerAppointments.userId, userId),
                        eq(officerAppointments.academicTermId, academicTermId),
                        eq(officerAppointments.isCurrent, true),
                    ),
                )
                .limit(1);
            return Boolean(appointment);
        },

        isTaskAssignee: async (userId, taskId) => {
            const [row] = await executor
                .select({ taskId: taskAssignees.taskId })
                .from(taskAssignees)
                .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
                .limit(1);
            return Boolean(row);
        },

        isTargetActiveOfficer: async (targetUserId, academicTermId) => {
            const [targetUser] = await executor
                .select({ systemRole: users.systemRole })
                .from(users)
                .where(eq(users.id, targetUserId))
                .limit(1);
            if (!targetUser) {
                return false;
            }
            if (targetUser.systemRole !== "MEMBER") {
                return true;
            }
            if (!academicTermId) {
                return false;
            }
            const [appointment] = await executor
                .select({ id: officerAppointments.id })
                .from(officerAppointments)
                .where(
                    and(
                        eq(officerAppointments.userId, targetUserId),
                        eq(officerAppointments.academicTermId, academicTermId),
                        eq(officerAppointments.isCurrent, true),
                    ),
                )
                .limit(1);
            return Boolean(appointment);
        },
    };
}

export async function authorize(
    ctx: AuthorizeContext,
    permission: Permission,
    resource: AuthorizeResourceContext = {},
    deps: AuthorizeDeps = {},
): Promise<AuthorizeSuccess> {
    // Stage 1: Authenticate Session
    const actor = ctx.actor;
    if (!actor) {
        throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    // Stage 2: Layer 0 Account Lifecycle Gate (BR-SYS-03 Step 1)
    if (actor.accountStatus !== "ACTIVE") {
        await deps.revokeAllUserSessions?.(actor.id);
        throw new AuthorizationError(
            403,
            "ACCOUNT_HOLD",
            "Account is not active. Contact SYComP administration.",
        );
    }

    // Stage 3: Layer 1 Global Tier & SUPER_ADMIN Break-Glass (never branch on position_title)
    const rule = PERMISSIONS[permission];
    const reason = ctx.reason?.trim() || null;
    let isBreakGlass = false;

    if (rule.nativeRoles.includes(actor.systemRole)) {
        // Allowed natively at Layer 1
    } else if (actor.systemRole === "SUPER_ADMIN" && rule.allowBreakGlass) {
        const allowStandingOfficerBypass =
            permission === "event:proposal:create" &&
            Boolean(resource.academicTermId && deps.hasActiveAppointment) &&
            (await deps.hasActiveAppointment!(actor.id, resource.academicTermId!));

        if (!allowStandingOfficerBypass) {
            if (ctx.breakGlass !== true || !reason || reason.length < 10) {
                throw new AuthorizationError(
                    400,
                    "BREAK_GLASS_REASON_REQUIRED",
                    "SUPER_ADMIN break-glass override requires break_glass: true and a reason of at least 10 characters.",
                );
            }
            isBreakGlass = true;
        }
    } else {
        throw new AuthorizationError(
            403,
            "FORBIDDEN",
            `Role ${actor.systemRole} lacks permission ${permission}.`,
        );
    }

    // Stage 4: Temporal & State Lock Check (BR-SYS-05)
    if (rule.isMutation) {
        const isTermLocked = resource.termStatus === "CLOSED";
        const isEventLocked =
            resource.eventStatus === "COMPLETED" || resource.eventStatus === "REJECTED";
        const isMeetingLocked =
            resource.meetingStatus === "COMPLETED" || resource.meetingStatus === "CANCELLED";

        if (isTermLocked || isEventLocked || isMeetingLocked) {
            if (actor.systemRole === "SUPER_ADMIN" && ctx.breakGlass === true) {
                if (!reason || reason.length < 10) {
                    throw new AuthorizationError(
                        400,
                        "BREAK_GLASS_REASON_REQUIRED",
                        "SUPER_ADMIN break-glass override requires break_glass: true and a reason of at least 10 characters.",
                    );
                }
                isBreakGlass = true;
            }

            const allowHistoricalExecOverride =
                Boolean(rule.allowExecutiveHistoricalOverride) &&
                actor.systemRole === "EXECUTIVE" &&
                Boolean(reason && reason.length >= 10) &&
                !isEventLocked &&
                !isMeetingLocked;

            if (!isBreakGlass && !allowHistoricalExecOverride) {
                throw new AuthorizationError(
                    409,
                    "RESOURCE_LOCKED",
                    "Record is locked because its term, event, or meeting is closed or completed.",
                );
            }
        }
    }

    // Stage 5: Contextual & Resource-Level Check (BR-SYS-03 Step 3)
    if (actor.systemRole === "MEMBER") {
        if (
            (permission === "account:self:update" || permission === "attendance:self:view") &&
            resource.targetUserId &&
            resource.targetUserId !== actor.id
        ) {
            throw new AuthorizationError(
                403,
                "IDOR_FORBIDDEN",
                "Members may access or update only their own records.",
            );
        }
    }

    if (actor.systemRole === "OFFICER") {
        if (permission === "event:draft:view" || permission === "event:proposal:edit") {
            if (!resource.ownerUserId || resource.ownerUserId !== actor.id) {
                throw new AuthorizationError(
                    403,
                    "FORBIDDEN",
                    "Only the proposal author or an Executive may access or edit this proposal.",
                );
            }
        }

        if (permission === "committee:members:manage" || permission === "task:committee:manage" || permission === "task:review:complete") {
            if (!resource.committeeId || !resource.academicTermId || !deps.isCommitteeHead) {
                throw new AuthorizationError(
                    403,
                    "COMMITTEE_HEAD_REQUIRED",
                    "Committee context and active Committee Head authority are required.",
                );
            }
            const isHead = await deps.isCommitteeHead(
                actor.id,
                resource.committeeId,
                resource.academicTermId,
            );
            if (!isHead) {
                throw new AuthorizationError(
                    403,
                    "COMMITTEE_HEAD_REQUIRED",
                    "Only the assigned active Committee Head or an Executive may manage this committee.",
                );
            }
        }

        if (permission === "task:assignee:progress") {
            if (!resource.taskId || !deps.isTaskAssignee) {
                throw new AuthorizationError(403, "FORBIDDEN", "Task assignee verification required.");
            }
            const assigned = await deps.isTaskAssignee(actor.id, resource.taskId);
            if (!assigned) {
                throw new AuthorizationError(
                    403,
                    "NOT_TASK_ASSIGNEE",
                    "Officers may update progress only on tasks assigned to them.",
                );
            }
        }

        if (permission === "meeting:minutes:edit") {
            if (resource.academicTermId && deps.hasActiveAppointment) {
                const active = await deps.hasActiveAppointment(actor.id, resource.academicTermId);
                if (!active) {
                    throw new AuthorizationError(
                        403,
                        "INACTIVE_APPOINTMENT",
                        "Active officer appointment is required to edit meeting minutes.",
                    );
                }
            }
        }

        if (permission === "attendance:scan") {
            const targetIsPrivilegedByRole =
                resource.targetSystemRole !== undefined && resource.targetSystemRole !== "MEMBER";
            const targetIsActiveOfficer =
                resource.targetUserId && deps.isTargetActiveOfficer
                    ? await deps.isTargetActiveOfficer(resource.targetUserId, resource.academicTermId)
                    : false;

            if (targetIsPrivilegedByRole || targetIsActiveOfficer) {
                throw new AuthorizationError(
                    403,
                    "OFFICER_SCAN_RESTRICTED",
                    "Regular officers cannot scan active Officers or Executives (BR-ATT-05).",
                );
            }
        }
    }

    if (permission === "attendance:scan" && resource.targetAccountStatus && resource.targetAccountStatus !== "ACTIVE") {
        throw new AuthorizationError(
            403,
            "TARGET_ACCOUNT_HOLD",
            "Cannot record attendance for a DISABLED or NEEDS_REVIEW account.",
        );
    }

    // Stage 6: Authorized — return sanitized actor DTO & audit context
    return {
        actor: toSessionActorDto(actor),
        isBreakGlass,
        reason,
    };
}
