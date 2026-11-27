import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import { announcementAudienceEnum, announcementStatusEnum } from "./enums";
import { events } from "./events";
import { academicTerms, users } from "./identity";

export const announcements = pgTable(
    "announcements",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
        title: varchar("title", { length: 200 }).notNull(),
        bodyHtml: text("body_html").notNull(),
        audience: announcementAudienceEnum("audience").notNull().default("ALL_MEMBERS"),
        status: announcementStatusEnum("status").notNull().default("DRAFT"),
        isPinned: boolean("is_pinned").notNull().default(false),
        authoredBy: uuid("authored_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "announcements_published_meta_chk",
            sql`${t.status} <> 'PUBLISHED' OR (${t.publishedBy} IS NOT NULL AND ${t.publishedAt} IS NOT NULL)`,
        ),
        index("announcements_feed_idx").on(
            t.status,
            t.audience,
            sql`${t.isPinned} DESC`,
            sql`${t.publishedAt} DESC`,
        ),
    ],
);

export const auditLogs = pgTable(
    "audit_logs",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
        action: varchar("action", { length: 80 }).notNull(),
        entityType: varchar("entity_type", { length: 60 }).notNull(),
        entityId: uuid("entity_id").notNull(),
        beforeState: jsonb("before_state"),
        afterState: jsonb("after_state"),
        reason: text("reason"),
        ipAddress: varchar("ip_address", { length: 45 }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index("audit_logs_entity_created_idx").on(
            t.entityType,
            t.entityId,
            sql`${t.createdAt} DESC`,
        ),
        index("audit_logs_actor_created_idx").on(t.actorId, sql`${t.createdAt} DESC`),
        index("audit_logs_action_created_idx").on(t.action, sql`${t.createdAt} DESC`),
    ],
);

export const rateLimitBuckets = pgTable(
    "rate_limit_buckets",
    {
        key: varchar("key", { length: 160 }).primaryKey(),
        count: integer("count").notNull().default(0),
        windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("rate_limit_buckets_expires_idx").on(t.windowExpiresAt)],
);
