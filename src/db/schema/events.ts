import { sql } from "drizzle-orm";
import {
    check,
    index,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import { eventProposalDecisionEnum, eventStatusEnum } from "./enums";
import { academicTerms, users } from "./identity";

export const events = pgTable(
    "events",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        title: varchar("title", { length: 200 }).notNull(),
        slug: varchar("slug", { length: 220 }).notNull(),
        descriptionHtml: text("description_html").notNull(),
        publicSummary: text("public_summary"),
        venue: varchar("venue", { length: 255 }),
        targetAudience: varchar("target_audience", { length: 150 }),
        startAt: timestamp("start_at", { withTimezone: true }).notNull(),
        endAt: timestamp("end_at", { withTimezone: true }).notNull(),
        status: eventStatusEnum("status").notNull().default("DRAFT"),
        revisionCount: smallint("revision_count").notNull().default(0),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
        approvedAt: timestamp("approved_at", { withTimezone: true }),
        publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check("events_date_range_chk", sql`${t.endAt} >= ${t.startAt}`),
        check(
            "events_published_meta_chk",
            sql`${t.status} <> 'PUBLISHED' OR (${t.publishedBy} IS NOT NULL AND ${t.publishedAt} IS NOT NULL)`,
        ),
        check(
            "events_completed_meta_chk",
            sql`${t.status} <> 'COMPLETED' OR (${t.completedBy} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
        ),
        unique("events_term_slug_uq").on(t.academicTermId, t.slug),
        index("events_term_status_idx").on(t.academicTermId, t.status),
        index("events_status_start_at_idx").on(t.status, t.startAt),
    ],
);

export const eventProposalReviews = pgTable(
    "event_proposal_reviews",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "restrict" }),
        reviewerId: uuid("reviewer_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        decisionType: eventProposalDecisionEnum("decision_type").notNull(),
        feedbackNote: text("feedback_note"),
        revisionNumber: smallint("revision_number").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "event_proposal_reviews_feedback_chk",
            sql`${t.decisionType} = 'APPROVED' OR (${t.feedbackNote} IS NOT NULL AND length(trim(${t.feedbackNote})) > 0)`,
        ),
        index("event_proposal_reviews_event_created_idx").on(t.eventId, t.createdAt),
    ],
);

export const eventCommittees = pgTable(
    "event_committees",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "restrict" }),
        name: varchar("name", { length: 120 }).notNull(),
        description: text("description"),
        headUserId: uuid("head_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique("event_committees_event_name_uq").on(t.eventId, t.name),
        unique("event_committees_id_event_uq").on(t.id, t.eventId),
        index("event_committees_head_event_idx").on(t.headUserId, t.eventId),
    ],
);

export const eventCommitteeMembers = pgTable(
    "event_committee_members",
    {
        committeeId: uuid("committee_id")
            .notNull()
            .references(() => eventCommittees.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        addedBy: uuid("added_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ name: "event_committee_members_pk", columns: [t.committeeId, t.userId] }),
        index("event_committee_members_user_idx").on(t.userId),
    ],
);
