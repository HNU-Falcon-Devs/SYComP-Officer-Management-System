import { pgEnum } from "drizzle-orm/pg-core";

export const systemRoleEnum = pgEnum("system_role", [
    "SUPER_ADMIN",
    "EXECUTIVE",
    "OFFICER",
    "MEMBER",
]);

export const grantedSystemRoleEnum = pgEnum("granted_system_role", [
    "SUPER_ADMIN",
    "EXECUTIVE",
    "OFFICER",
]);

export const accountStatusEnum = pgEnum("account_status", [
    "ACTIVE",
    "DISABLED",
    "NEEDS_REVIEW",
]);

export const verificationTokenPurposeEnum = pgEnum("verification_token_purpose", [
    "EMAIL_VERIFICATION",
    "PASSWORD_RESET",
]);

export const academicTermStatusEnum = pgEnum("academic_term_status", [
    "DRAFT",
    "ACTIVE",
    "CLOSED",
]);

export const eventStatusEnum = pgEnum("event_status", [
    "DRAFT",
    "PENDING_REVIEW",
    "NEEDS_REVISION",
    "REJECTED",
    "APPROVED",
    "PUBLISHED",
    "COMPLETED",
]);

export const eventProposalDecisionEnum = pgEnum("event_proposal_decision", [
    "COMMENT",
    "REQUEST_REVISION",
    "APPROVED",
    "REJECTED",
    "UNPUBLISHED",
]);

export const taskStatusEnum = pgEnum("task_status", [
    "TO_DO",
    "IN_PROGRESS",
    "FOR_REVIEW",
    "DONE",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
    "LOW",
    "MEDIUM",
    "HIGH",
    "URGENT",
]);

export const meetingStatusEnum = pgEnum("meeting_status", [
    "SCHEDULED",
    "ONGOING",
    "COMPLETED",
    "CANCELLED",
]);

export const checkpointAudienceScopeEnum = pgEnum("checkpoint_audience_scope", [
    "GENERAL_MEMBERS",
    "OFFICERS_ONLY",
    "ALL",
]);

export const checkpointStatusEnum = pgEnum("checkpoint_status", [
    "SCHEDULED",
    "OPEN",
    "CLOSED",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
    "PRESENT",
    "LATE",
    "EXCUSED",
    "ABSENT",
]);

export const attendanceRecordedViaEnum = pgEnum("attendance_recorded_via", [
    "QR_SCAN",
    "MANUAL_EXECUTIVE",
]);

export const documentStatusEnum = pgEnum("document_status", [
    "DRAFT",
    "FOR_REVIEW",
    "SUBMITTED",
    "APPROVED",
    "ARCHIVED",
]);

export const documentStorageModeEnum = pgEnum("document_storage_mode", [
    "DRIVE_UPLOAD",
    "EXTERNAL_LINK",
]);

export const announcementAudienceEnum = pgEnum("announcement_audience", [
    "ALL_MEMBERS",
    "OFFICERS_ONLY",
]);

export const announcementStatusEnum = pgEnum("announcement_status", [
    "DRAFT",
    "PUBLISHED",
    "ARCHIVED",
]);
