import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { meetingStatusEnum } from "./enums";
import { academicTerms, users } from "./identity";

export const meetings = pgTable(
    "meetings",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        title: varchar("title", { length: 200 }).notNull(),
        scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),
        scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
        locationOrLink: varchar("location_or_link", { length: 255 }),
        agendaHtml: text("agenda_html"),
        minutesHtml: text("minutes_html"),
        status: meetingStatusEnum("status").notNull().default("SCHEDULED"),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "meetings_end_after_start_chk",
            sql`${t.scheduledEndAt} IS NULL OR ${t.scheduledEndAt} >= ${t.scheduledStartAt}`,
        ),
        check(
            "meetings_completed_at_chk",
            sql`${t.status} <> 'COMPLETED' OR ${t.completedAt} IS NOT NULL`,
        ),
        index("meetings_term_status_start_idx").on(
            t.academicTermId,
            t.status,
            t.scheduledStartAt,
        ),
    ],
);
