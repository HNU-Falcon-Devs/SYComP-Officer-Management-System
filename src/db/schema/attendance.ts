import { sql } from "drizzle-orm";
import {
    check,
    index,
    pgTable,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import {
    attendanceRecordedViaEnum,
    attendanceStatusEnum,
    checkpointAudienceScopeEnum,
    checkpointStatusEnum,
} from "./enums";
import { events } from "./events";
import { users } from "./identity";
import { meetings } from "./meetings";

export const attendanceCheckpoints = pgTable(
    "attendance_checkpoints",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
        meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "restrict" }),
        label: varchar("label", { length: 100 }).notNull(),
        audienceScope: checkpointAudienceScopeEnum("audience_scope").notNull().default("ALL"),
        sortOrder: smallint("sort_order").notNull().default(1),
        opensAt: timestamp("opens_at", { withTimezone: true }),
        closesAt: timestamp("closes_at", { withTimezone: true }),
        status: checkpointStatusEnum("status").notNull().default("SCHEDULED"),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "attendance_checkpoints_xor_parent_chk",
            sql`(${t.eventId} IS NOT NULL AND ${t.meetingId} IS NULL) OR (${t.eventId} IS NULL AND ${t.meetingId} IS NOT NULL)`,
        ),
        check(
            "attendance_checkpoints_meeting_scope_chk",
            sql`${t.meetingId} IS NULL OR ${t.audienceScope} = 'OFFICERS_ONLY'`,
        ),
        check(
            "attendance_checkpoints_window_chk",
            sql`${t.opensAt} IS NULL OR ${t.closesAt} IS NULL OR ${t.closesAt} >= ${t.opensAt}`,
        ),
        uniqueIndex("attendance_checkpoints_event_label_uq")
            .on(t.eventId, t.label)
            .where(sql`${t.eventId} IS NOT NULL`),
        uniqueIndex("attendance_checkpoints_meeting_label_uq")
            .on(t.meetingId, t.label)
            .where(sql`${t.meetingId} IS NOT NULL`),
    ],
);

export const attendanceRecords = pgTable(
    "attendance_records",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        checkpointId: uuid("checkpoint_id")
            .notNull()
            .references(() => attendanceCheckpoints.id, { onDelete: "restrict" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        status: attendanceStatusEnum("status").notNull().default("PRESENT"),
        recordedVia: attendanceRecordedViaEnum("recorded_via").notNull().default("QR_SCAN"),
        recordedBy: uuid("recorded_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
        lastEditedBy: uuid("last_edited_by").references(() => users.id, {
            onDelete: "restrict",
        }),
        lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
        editReason: text("edit_reason"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique("attendance_records_checkpoint_user_uq").on(t.checkpointId, t.userId),
        check(
            "attendance_records_edit_pair_chk",
            sql`(${t.lastEditedBy} IS NULL) = (${t.lastEditedAt} IS NULL)`,
        ),
        check(
            "attendance_records_edit_reason_chk",
            sql`(${t.lastEditedBy} IS NULL AND ${t.recordedVia} = 'QR_SCAN') OR (${t.editReason} IS NOT NULL AND length(trim(${t.editReason})) > 0)`,
        ),
        index("attendance_records_user_recorded_idx").on(t.userId, t.recordedAt),
    ],
);
