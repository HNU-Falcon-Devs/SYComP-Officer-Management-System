CREATE TYPE "public"."academic_term_status" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'DISABLED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."announcement_audience" AS ENUM('ALL_MEMBERS', 'OFFICERS_ONLY');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."attendance_recorded_via" AS ENUM('QR_SCAN', 'MANUAL_EXECUTIVE');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('PRESENT', 'LATE', 'EXCUSED', 'ABSENT');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_audience_scope" AS ENUM('GENERAL_MEMBERS', 'OFFICERS_ONLY', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_status" AS ENUM('SCHEDULED', 'OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('DRAFT', 'FOR_REVIEW', 'SUBMITTED', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."document_storage_mode" AS ENUM('DRIVE_UPLOAD', 'EXTERNAL_LINK');--> statement-breakpoint
CREATE TYPE "public"."event_proposal_decision" AS ENUM('COMMENT', 'REQUEST_REVISION', 'APPROVED', 'REJECTED', 'UNPUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'NEEDS_REVISION', 'REJECTED', 'APPROVED', 'PUBLISHED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."granted_system_role" AS ENUM('SUPER_ADMIN', 'EXECUTIVE', 'OFFICER');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('SUPER_ADMIN', 'EXECUTIVE', 'OFFICER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('TO_DO', 'IN_PROGRESS', 'FOR_REVIEW', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."verification_token_purpose" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "academic_term_status" DEFAULT 'DRAFT' NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_code_unique" UNIQUE("code"),
	CONSTRAINT "academic_terms_name_unique" UNIQUE("name"),
	CONSTRAINT "academic_terms_date_range_chk" CHECK ("academic_terms"."end_date" >= "academic_terms"."start_date"),
	CONSTRAINT "academic_terms_closed_at_chk" CHECK ("academic_terms"."status" <> 'CLOSED' OR "academic_terms"."closed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "masterlist_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"source_filename" varchar(255) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_existing_count" integer DEFAULT 0 NOT NULL,
	"flagged_review_count" integer DEFAULT 0 NOT NULL,
	"report_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officer_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"position_title" varchar(120) NOT NULL,
	"granted_system_role" "granted_system_role" NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"appointed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "officer_appointments_current_ended_chk" CHECK (("officer_appointments"."is_current" = true AND "officer_appointments"."ended_at" IS NULL) OR ("officer_appointments"."is_current" = false AND "officer_appointments"."ended_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role_tier_snapshot" "system_role" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" varchar(45),
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id_number" varchar(32) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"middle_name" varchar(100),
	"last_name" varchar(100) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"university_email" varchar(255),
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"system_role" "system_role" DEFAULT 'MEMBER' NOT NULL,
	"account_status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"status_reason" varchar(100),
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_student_id_number_unique" UNIQUE("student_id_number"),
	CONSTRAINT "users_disabled_at_chk" CHECK ("users"."account_status" <> 'DISABLED' OR "users"."disabled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "verification_token_purpose" NOT NULL,
	"target_email" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_committee_members" (
	"committee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_committee_members_pk" PRIMARY KEY("committee_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_committees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"head_user_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_committees_event_name_uq" UNIQUE("event_id","name"),
	CONSTRAINT "event_committees_id_event_uq" UNIQUE("id","event_id")
);
--> statement-breakpoint
CREATE TABLE "event_proposal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision_type" "event_proposal_decision" NOT NULL,
	"feedback_note" text,
	"revision_number" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_proposal_reviews_feedback_chk" CHECK ("event_proposal_reviews"."decision_type" = 'APPROVED' OR ("event_proposal_reviews"."feedback_note" IS NOT NULL AND length(trim("event_proposal_reviews"."feedback_note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"description_html" text NOT NULL,
	"public_summary" text,
	"venue" varchar(255),
	"target_audience" varchar(150),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "event_status" DEFAULT 'DRAFT' NOT NULL,
	"revision_count" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_term_slug_uq" UNIQUE("academic_term_id","slug"),
	CONSTRAINT "events_date_range_chk" CHECK ("events"."end_at" >= "events"."start_at"),
	CONSTRAINT "events_published_meta_chk" CHECK ("events"."status" <> 'PUBLISHED' OR ("events"."published_by" IS NOT NULL AND "events"."published_at" IS NOT NULL)),
	CONSTRAINT "events_completed_meta_chk" CHECK ("events"."status" <> 'COMPLETED' OR ("events"."completed_by" IS NOT NULL AND "events"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone,
	"location_or_link" varchar(255),
	"agenda_html" text,
	"minutes_html" text,
	"status" "meeting_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_end_after_start_chk" CHECK ("meetings"."scheduled_end_at" IS NULL OR "meetings"."scheduled_end_at" >= "meetings"."scheduled_start_at"),
	CONSTRAINT "meetings_completed_at_chk" CHECK ("meetings"."status" <> 'COMPLETED' OR "meetings"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"drive_folder_segment" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_name_unique" UNIQUE("name"),
	CONSTRAINT "document_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"event_id" uuid,
	"meeting_id" uuid,
	"is_proposal_attachment" boolean DEFAULT false NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" "document_status" DEFAULT 'DRAFT' NOT NULL,
	"storage_mode" "document_storage_mode" DEFAULT 'DRIVE_UPLOAD' NOT NULL,
	"drive_file_id" varchar(128),
	"drive_folder_cache_id" uuid,
	"web_view_link" text NOT NULL,
	"original_filename" varchar(255),
	"mime_type" varchar(128),
	"file_size_bytes" bigint,
	"uploaded_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_single_parent_chk" CHECK (NOT ("documents"."event_id" IS NOT NULL AND "documents"."meeting_id" IS NOT NULL)),
	CONSTRAINT "documents_proposal_requires_event_chk" CHECK (NOT "documents"."is_proposal_attachment" OR "documents"."event_id" IS NOT NULL),
	CONSTRAINT "documents_drive_file_required_chk" CHECK ("documents"."storage_mode" = 'EXTERNAL_LINK' OR "documents"."drive_file_id" IS NOT NULL),
	CONSTRAINT "documents_approved_pair_chk" CHECK (("documents"."approved_by" IS NULL) = ("documents"."approved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "drive_folder_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"path_key" varchar(400) NOT NULL,
	"drive_folder_id" varchar(128) NOT NULL,
	"parent_drive_folder_id" varchar(128),
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_folder_cache_path_key_unique" UNIQUE("path_key"),
	CONSTRAINT "drive_folder_cache_drive_folder_id_unique" UNIQUE("drive_folder_id")
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignees_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"event_id" uuid,
	"committee_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'TO_DO' NOT NULL,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"due_at" timestamp with time zone,
	"linked_document_id" uuid,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_committee_requires_event_chk" CHECK ("tasks"."committee_id" IS NULL OR "tasks"."event_id" IS NOT NULL),
	CONSTRAINT "tasks_completed_pair_chk" CHECK (("tasks"."completed_by" IS NULL) = ("tasks"."completed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "attendance_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"meeting_id" uuid,
	"label" varchar(100) NOT NULL,
	"audience_scope" "checkpoint_audience_scope" DEFAULT 'ALL' NOT NULL,
	"sort_order" smallint DEFAULT 1 NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"status" "checkpoint_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_checkpoints_xor_parent_chk" CHECK (("attendance_checkpoints"."event_id" IS NOT NULL AND "attendance_checkpoints"."meeting_id" IS NULL) OR ("attendance_checkpoints"."event_id" IS NULL AND "attendance_checkpoints"."meeting_id" IS NOT NULL)),
	CONSTRAINT "attendance_checkpoints_meeting_scope_chk" CHECK ("attendance_checkpoints"."meeting_id" IS NULL OR "attendance_checkpoints"."audience_scope" = 'OFFICERS_ONLY'),
	CONSTRAINT "attendance_checkpoints_window_chk" CHECK ("attendance_checkpoints"."opens_at" IS NULL OR "attendance_checkpoints"."closes_at" IS NULL OR "attendance_checkpoints"."closes_at" >= "attendance_checkpoints"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "attendance_status" DEFAULT 'PRESENT' NOT NULL,
	"recorded_via" "attendance_recorded_via" DEFAULT 'QR_SCAN' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_by" uuid,
	"last_edited_at" timestamp with time zone,
	"edit_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_checkpoint_user_uq" UNIQUE("checkpoint_id","user_id"),
	CONSTRAINT "attendance_records_edit_pair_chk" CHECK (("attendance_records"."last_edited_by" IS NULL) = ("attendance_records"."last_edited_at" IS NULL)),
	CONSTRAINT "attendance_records_edit_reason_chk" CHECK (("attendance_records"."last_edited_by" IS NULL AND "attendance_records"."recorded_via" = 'QR_SCAN') OR ("attendance_records"."edit_reason" IS NOT NULL AND length(trim("attendance_records"."edit_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_term_id" uuid NOT NULL,
	"event_id" uuid,
	"title" varchar(200) NOT NULL,
	"body_html" text NOT NULL,
	"audience" "announcement_audience" DEFAULT 'ALL_MEMBERS' NOT NULL,
	"status" "announcement_status" DEFAULT 'DRAFT' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"authored_by" uuid NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_published_meta_chk" CHECK ("announcements"."status" <> 'PUBLISHED' OR ("announcements"."published_by" IS NOT NULL AND "announcements"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "masterlist_imports" ADD CONSTRAINT "masterlist_imports_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "masterlist_imports" ADD CONSTRAINT "masterlist_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_appointments" ADD CONSTRAINT "officer_appointments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_appointments" ADD CONSTRAINT "officer_appointments_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_appointments" ADD CONSTRAINT "officer_appointments_appointed_by_users_id_fk" FOREIGN KEY ("appointed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committee_members" ADD CONSTRAINT "event_committee_members_committee_id_event_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."event_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committee_members" ADD CONSTRAINT "event_committee_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committee_members" ADD CONSTRAINT "event_committee_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committees" ADD CONSTRAINT "event_committees_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committees" ADD CONSTRAINT "event_committees_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_committees" ADD CONSTRAINT "event_committees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal_reviews" ADD CONSTRAINT "event_proposal_reviews_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal_reviews" ADD CONSTRAINT "event_proposal_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_drive_folder_cache_id_drive_folder_cache_id_fk" FOREIGN KEY ("drive_folder_cache_id") REFERENCES "public"."drive_folder_cache"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folder_cache" ADD CONSTRAINT "drive_folder_cache_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_document_id_documents_id_fk" FOREIGN KEY ("linked_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_committee_event_fk" FOREIGN KEY ("committee_id","event_id") REFERENCES "public"."event_committees"("id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_checkpoints" ADD CONSTRAINT "attendance_checkpoints_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_checkpoints" ADD CONSTRAINT "attendance_checkpoints_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_checkpoints" ADD CONSTRAINT "attendance_checkpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_checkpoint_id_attendance_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."attendance_checkpoints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_single_active_uq" ON "academic_terms" USING btree ("status") WHERE "academic_terms"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "masterlist_imports_term_created_idx" ON "masterlist_imports" USING btree ("academic_term_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "officer_appointments_active_title_uq" ON "officer_appointments" USING btree ("user_id","academic_term_id","position_title") WHERE "officer_appointments"."is_current" = true;--> statement-breakpoint
CREATE INDEX "officer_appointments_term_current_idx" ON "officer_appointments" USING btree ("academic_term_id","is_current");--> statement-breakpoint
CREATE INDEX "officer_appointments_user_current_idx" ON "officer_appointments" USING btree ("user_id","is_current");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_university_email_uq" ON "users" USING btree ("university_email") WHERE "users"."university_email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_account_status_system_role_idx" ON "users" USING btree ("account_status","system_role");--> statement-breakpoint
CREATE INDEX "users_last_name_first_name_idx" ON "users" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_purpose_expires_idx" ON "verification_tokens" USING btree ("user_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "event_committee_members_user_idx" ON "event_committee_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_committees_head_event_idx" ON "event_committees" USING btree ("head_user_id","event_id");--> statement-breakpoint
CREATE INDEX "event_proposal_reviews_event_created_idx" ON "event_proposal_reviews" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "events_term_status_idx" ON "events" USING btree ("academic_term_id","status");--> statement-breakpoint
CREATE INDEX "events_status_start_at_idx" ON "events" USING btree ("status","start_at");--> statement-breakpoint
CREATE INDEX "meetings_term_status_start_idx" ON "meetings" USING btree ("academic_term_id","status","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "documents_term_type_status_idx" ON "documents" USING btree ("academic_term_id","document_type_id","status");--> statement-breakpoint
CREATE INDEX "documents_event_idx" ON "documents" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "documents_meeting_idx" ON "documents" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_event_committee_status_idx" ON "tasks" USING btree ("event_id","committee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_term_status_due_idx" ON "tasks" USING btree ("academic_term_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_checkpoints_event_label_uq" ON "attendance_checkpoints" USING btree ("event_id","label") WHERE "attendance_checkpoints"."event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_checkpoints_meeting_label_uq" ON "attendance_checkpoints" USING btree ("meeting_id","label") WHERE "attendance_checkpoints"."meeting_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attendance_records_user_recorded_idx" ON "attendance_records" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "announcements_feed_idx" ON "announcements" USING btree ("status","audience","is_pinned" DESC,"published_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_created_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at" DESC);--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" USING btree ("window_expires_at");