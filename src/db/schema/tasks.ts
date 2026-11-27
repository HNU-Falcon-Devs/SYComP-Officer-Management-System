import { sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { taskPriorityEnum, taskStatusEnum } from "./enums";
import { eventCommittees, events } from "./events";
import { academicTerms, users } from "./identity";

export const tasks = pgTable(
    "tasks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
        committeeId: uuid("committee_id"),
        title: varchar("title", { length: 200 }).notNull(),
        description: text("description"),
        status: taskStatusEnum("status").notNull().default("TO_DO"),
        priority: taskPriorityEnum("priority").notNull().default("MEDIUM"),
        dueAt: timestamp("due_at", { withTimezone: true }),
        linkedDocumentId: uuid("linked_document_id").references(() => documents.id, {
            onDelete: "restrict",
        }),
        createdBy: uuid("created_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "tasks_committee_requires_event_chk",
            sql`${t.committeeId} IS NULL OR ${t.eventId} IS NOT NULL`,
        ),
        foreignKey({
            name: "tasks_committee_event_fk",
            columns: [t.committeeId, t.eventId],
            foreignColumns: [eventCommittees.id, eventCommittees.eventId],
        }).onDelete("restrict"),
        check(
            "tasks_completed_pair_chk",
            sql`(${t.completedBy} IS NULL) = (${t.completedAt} IS NULL)`,
        ),
        index("tasks_event_committee_status_idx").on(t.eventId, t.committeeId, t.status),
        index("tasks_term_status_due_idx").on(t.academicTermId, t.status, t.dueAt),
    ],
);

export const taskAssignees = pgTable(
    "task_assignees",
    {
        taskId: uuid("task_id")
            .notNull()
            .references(() => tasks.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        assignedBy: uuid("assigned_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ name: "task_assignees_pk", columns: [t.taskId, t.userId] }),
        index("task_assignees_user_idx").on(t.userId),
    ],
);
