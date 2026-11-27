import { sql } from "drizzle-orm";
import {
    type AnyPgColumn,
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import {
    academicTermStatusEnum,
    accountStatusEnum,
    grantedSystemRoleEnum,
    systemRoleEnum,
    verificationTokenPurposeEnum,
} from "./enums";

export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studentIdNumber: varchar("student_id_number", { length: 32 }).notNull().unique(),
        firstName: varchar("first_name", { length: 100 }).notNull(),
        middleName: varchar("middle_name", { length: 100 }),
        lastName: varchar("last_name", { length: 100 }).notNull(),
        fullName: varchar("full_name", { length: 255 }).notNull(),
        universityEmail: varchar("university_email", { length: 255 }),
        emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
        passwordHash: text("password_hash").notNull(),
        mustChangePassword: boolean("must_change_password").notNull().default(true),
        systemRole: systemRoleEnum("system_role").notNull().default("MEMBER"),
        accountStatus: accountStatusEnum("account_status").notNull().default("ACTIVE"),
        statusReason: varchar("status_reason", { length: 100 }),
        disabledAt: timestamp("disabled_at", { withTimezone: true }),
        disabledBy: uuid("disabled_by").references((): AnyPgColumn => users.id, {
            onDelete: "restrict",
        }),
        lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("users_university_email_uq")
            .on(t.universityEmail)
            .where(sql`${t.universityEmail} IS NOT NULL`),
        index("users_account_status_system_role_idx").on(t.accountStatus, t.systemRole),
        index("users_last_name_first_name_idx").on(t.lastName, t.firstName),
        check(
            "users_disabled_at_chk",
            sql`${t.accountStatus} <> 'DISABLED' OR ${t.disabledAt} IS NOT NULL`,
        ),
    ],
);

export const userSessions = pgTable(
    "user_sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull().unique(),
        roleTierSnapshot: systemRoleEnum("role_tier_snapshot").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: varchar("user_agent", { length: 255 }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("user_sessions_user_id_revoked_at_idx").on(t.userId, t.revokedAt),
        index("user_sessions_expires_at_idx").on(t.expiresAt),
    ],
);

export const verificationTokens = pgTable(
    "verification_tokens",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        purpose: verificationTokenPurposeEnum("purpose").notNull(),
        targetEmail: varchar("target_email", { length: 255 }).notNull(),
        tokenHash: text("token_hash").notNull(),
        attemptCount: smallint("attempt_count").notNull().default(0),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        consumedAt: timestamp("consumed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("verification_tokens_user_purpose_expires_idx").on(
            t.userId,
            t.purpose,
            t.expiresAt,
        ),
    ],
);

export const academicTerms = pgTable(
    "academic_terms",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        code: varchar("code", { length: 40 }).notNull().unique(),
        name: varchar("name", { length: 120 }).notNull().unique(),
        startDate: date("start_date").notNull(),
        endDate: date("end_date").notNull(),
        status: academicTermStatusEnum("status").notNull().default("DRAFT"),
        activatedAt: timestamp("activated_at", { withTimezone: true }),
        closedAt: timestamp("closed_at", { withTimezone: true }),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check("academic_terms_date_range_chk", sql`${t.endDate} >= ${t.startDate}`),
        check(
            "academic_terms_closed_at_chk",
            sql`${t.status} <> 'CLOSED' OR ${t.closedAt} IS NOT NULL`,
        ),
        uniqueIndex("academic_terms_single_active_uq")
            .on(t.status)
            .where(sql`${t.status} = 'ACTIVE'`),
    ],
);

export const officerAppointments = pgTable(
    "officer_appointments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        positionTitle: varchar("position_title", { length: 120 }).notNull(),
        grantedSystemRole: grantedSystemRoleEnum("granted_system_role").notNull(),
        isCurrent: boolean("is_current").notNull().default(true),
        appointedAt: timestamp("appointed_at", { withTimezone: true }).notNull().defaultNow(),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        appointedBy: uuid("appointed_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "officer_appointments_current_ended_chk",
            sql`(${t.isCurrent} = true AND ${t.endedAt} IS NULL) OR (${t.isCurrent} = false AND ${t.endedAt} IS NOT NULL)`,
        ),
        uniqueIndex("officer_appointments_active_title_uq")
            .on(t.userId, t.academicTermId, t.positionTitle)
            .where(sql`${t.isCurrent} = true`),
        index("officer_appointments_term_current_idx").on(t.academicTermId, t.isCurrent),
        index("officer_appointments_user_current_idx").on(t.userId, t.isCurrent),
    ],
);

export const masterlistImports = pgTable(
    "masterlist_imports",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        uploadedBy: uuid("uploaded_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        sourceFilename: varchar("source_filename", { length: 255 }).notNull(),
        totalRows: integer("total_rows").notNull().default(0),
        createdCount: integer("created_count").notNull().default(0),
        skippedExistingCount: integer("skipped_existing_count").notNull().default(0),
        flaggedReviewCount: integer("flagged_review_count").notNull().default(0),
        reportSummary: jsonb("report_summary"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("masterlist_imports_term_created_idx").on(t.academicTermId, sql`${t.createdAt} DESC`),
    ],
);
