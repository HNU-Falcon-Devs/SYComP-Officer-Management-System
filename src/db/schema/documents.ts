import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    index,
    pgTable,
    text,
    timestamp,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import { documentStatusEnum, documentStorageModeEnum } from "./enums";
import { events } from "./events";
import { academicTerms, users } from "./identity";
import { meetings } from "./meetings";

export const documentTypes = pgTable("document_types", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    driveFolderSegment: varchar("drive_folder_segment", { length: 120 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const driveFolderCache = pgTable("drive_folder_cache", {
    id: uuid("id").defaultRandom().primaryKey(),
    academicTermId: uuid("academic_term_id")
        .notNull()
        .references(() => academicTerms.id, { onDelete: "restrict" }),
    pathKey: varchar("path_key", { length: 400 }).notNull().unique(),
    driveFolderId: varchar("drive_folder_id", { length: 128 }).notNull().unique(),
    parentDriveFolderId: varchar("parent_drive_folder_id", { length: 128 }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
    "documents",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        academicTermId: uuid("academic_term_id")
            .notNull()
            .references(() => academicTerms.id, { onDelete: "restrict" }),
        documentTypeId: uuid("document_type_id")
            .notNull()
            .references(() => documentTypes.id, { onDelete: "restrict" }),
        eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
        meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "restrict" }),
        isProposalAttachment: boolean("is_proposal_attachment").notNull().default(false),
        title: varchar("title", { length: 200 }).notNull(),
        status: documentStatusEnum("status").notNull().default("DRAFT"),
        storageMode: documentStorageModeEnum("storage_mode").notNull().default("DRIVE_UPLOAD"),
        driveFileId: varchar("drive_file_id", { length: 128 }),
        driveFolderCacheId: uuid("drive_folder_cache_id").references(() => driveFolderCache.id, {
            onDelete: "restrict",
        }),
        webViewLink: text("web_view_link").notNull(),
        originalFilename: varchar("original_filename", { length: 255 }),
        mimeType: varchar("mime_type", { length: 128 }),
        fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
        uploadedBy: uuid("uploaded_by")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
        approvedAt: timestamp("approved_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        check(
            "documents_single_parent_chk",
            sql`NOT (${t.eventId} IS NOT NULL AND ${t.meetingId} IS NOT NULL)`,
        ),
        check(
            "documents_proposal_requires_event_chk",
            sql`NOT ${t.isProposalAttachment} OR ${t.eventId} IS NOT NULL`,
        ),
        check(
            "documents_drive_file_required_chk",
            sql`${t.storageMode} = 'EXTERNAL_LINK' OR ${t.driveFileId} IS NOT NULL`,
        ),
        check(
            "documents_approved_pair_chk",
            sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL)`,
        ),
        index("documents_term_type_status_idx").on(t.academicTermId, t.documentTypeId, t.status),
        index("documents_event_idx").on(t.eventId),
        index("documents_meeting_idx").on(t.meetingId),
    ],
);
