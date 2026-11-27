-- PostgREST Lockdown: enable RLS on all 21 tables with zero anon/authenticated policies
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."academic_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."officer_appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."masterlist_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."event_proposal_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."event_committees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."event_committee_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."document_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."drive_folder_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."task_assignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attendance_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."rate_limit_buckets" ENABLE ROW LEVEL SECURITY;

-- Append-only audit_logs immutability trigger (blocks UPDATE and DELETE even for privileged roles)
CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only; % operations are prohibited', TG_OP
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_logs_immutable_trg"
    BEFORE UPDATE OR DELETE ON "public"."audit_logs"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_audit_log_mutation"();

-- Non-destructive historical lifecycle protection (BR-SYS-02)
CREATE OR REPLACE FUNCTION "public"."prevent_historical_hard_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Hard delete prohibited on historical table %; use soft-disable or status transition instead', TG_TABLE_NAME
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "users_no_hard_delete_trg"
    BEFORE DELETE ON "public"."users"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();

CREATE TRIGGER "academic_terms_no_hard_delete_trg"
    BEFORE DELETE ON "public"."academic_terms"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();

CREATE TRIGGER "officer_appointments_no_hard_delete_trg"
    BEFORE DELETE ON "public"."officer_appointments"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();

CREATE TRIGGER "events_no_hard_delete_trg"
    BEFORE DELETE ON "public"."events"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();

CREATE TRIGGER "meetings_no_hard_delete_trg"
    BEFORE DELETE ON "public"."meetings"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();

CREATE TRIGGER "attendance_records_no_hard_delete_trg"
    BEFORE DELETE ON "public"."attendance_records"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."prevent_historical_hard_delete"();
