import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import {
    academicTerms,
    documents,
    documentTypes,
    driveFolderCache,
    events,
    meetings,
    users,
} from "@/db/schema";
import {
    escapeLikePattern,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
} from "@/lib/admin/audit-logs";
import { buildSafeDrivePreviewUrl, resolveDriveFolderPath } from "./classifier";
import type {
    ActiveDocumentTypeOption,
    DocumentActorSummary,
    DocumentDto,
    DocumentEventOption,
    DocumentsListQuery,
    DocumentTermOption,
} from "./validation";

export type DocumentTargetContext =
    | {
          ok: true;
          academicTerm: {
              id: string;
              code: string;
              name: string;
              status: "DRAFT" | "ACTIVE" | "CLOSED";
          };
          event: {
              id: string;
              title: string;
              slug: string;
              status:
                  | "DRAFT"
                  | "PENDING_REVIEW"
                  | "NEEDS_REVISION"
                  | "REJECTED"
                  | "APPROVED"
                  | "PUBLISHED"
                  | "COMPLETED";
          } | null;
          meeting: {
              id: string;
              title: string;
              status: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
          } | null;
      }
    | { ok: false; code: "EVENT_NOT_FOUND" | "MEETING_NOT_FOUND" | "NO_ACTIVE_TERM"; status: 404 | 409; message: string };

export async function resolveDocumentTargetContext(
    executor: DbExecutor,
    input: { eventId?: string | null; meetingId?: string | null },
): Promise<DocumentTargetContext> {
    if (input.eventId) {
        const [row] = await executor
            .select({
                eventId: events.id,
                eventTitle: events.title,
                eventSlug: events.slug,
                eventStatus: events.status,
                termId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(events)
            .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
            .where(eq(events.id, input.eventId))
            .limit(1);

        if (!row) {
            return {
                ok: false,
                status: 404,
                code: "EVENT_NOT_FOUND",
                message: "Target event was not found.",
            };
        }

        return {
            ok: true,
            academicTerm: {
                id: row.termId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            event: {
                id: row.eventId,
                title: row.eventTitle,
                slug: row.eventSlug,
                status: row.eventStatus,
            },
            meeting: null,
        };
    }

    if (input.meetingId) {
        const [row] = await executor
            .select({
                meetingId: meetings.id,
                meetingTitle: meetings.title,
                meetingStatus: meetings.status,
                termId: academicTerms.id,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
            })
            .from(meetings)
            .innerJoin(academicTerms, eq(meetings.academicTermId, academicTerms.id))
            .where(eq(meetings.id, input.meetingId))
            .limit(1);

        if (!row) {
            return {
                ok: false,
                status: 404,
                code: "MEETING_NOT_FOUND",
                message: "Target officer meeting was not found.",
            };
        }

        return {
            ok: true,
            academicTerm: {
                id: row.termId,
                code: row.termCode,
                name: row.termName,
                status: row.termStatus,
            },
            event: null,
            meeting: {
                id: row.meetingId,
                title: row.meetingTitle,
                status: row.meetingStatus,
            },
        };
    }

    const [activeTerm] = await executor
        .select({
            id: academicTerms.id,
            code: academicTerms.code,
            name: academicTerms.name,
            status: academicTerms.status,
        })
        .from(academicTerms)
        .where(eq(academicTerms.status, "ACTIVE"))
        .limit(1);

    if (!activeTerm) {
        return {
            ok: false,
            status: 409,
            code: "NO_ACTIVE_TERM",
            message: "An ACTIVE academic term is required before uploading general documents.",
        };
    }

    return {
        ok: true,
        academicTerm: activeTerm,
        event: null,
        meeting: null,
    };
}

interface RawDocumentJoinRow {
    doc: typeof documents.$inferSelect;
    termCode: string;
    termName: string;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    docTypeName: string;
    docTypeSlug: string;
    docTypeSegment: string;
    eventTitle: string | null;
    eventSlug: string | null;
    eventStatus: string | null;
    meetingTitle: string | null;
    meetingStatus: string | null;
    cachePathKey: string | null;
}

function mapRawRowToDto(
    row: RawDocumentJoinRow,
    actorMap: Map<string, DocumentActorSummary>,
): DocumentDto {
    const resolvedPath = resolveDriveFolderPath({
        academicTermName: row.termName,
        academicTermCode: row.termCode,
        documentTypeSegment: row.docTypeSegment,
        documentTypeSlug: row.docTypeSlug,
        eventTitle: row.eventTitle,
        eventSlug: row.eventSlug,
        isProposal: row.doc.isProposalAttachment,
    });

    const drivePathDisplay =
        row.doc.storageMode === "EXTERNAL_LINK"
            ? "External Google Drive Link"
            : resolvedPath.displayPath;

    return {
        id: row.doc.id,
        title: row.doc.title,
        status: row.doc.status,
        storageMode: row.doc.storageMode,
        isProposalAttachment: row.doc.isProposalAttachment,
        academicTerm: {
            id: row.doc.academicTermId,
            code: row.termCode,
            name: row.termName,
            status: row.termStatus,
        },
        documentType: {
            id: row.doc.documentTypeId,
            name: row.docTypeName,
            slug: row.docTypeSlug,
            driveFolderSegment: row.docTypeSegment,
        },
        event:
            row.doc.eventId && row.eventTitle && row.eventSlug && row.eventStatus
                ? {
                      id: row.doc.eventId,
                      title: row.eventTitle,
                      slug: row.eventSlug,
                      status: row.eventStatus,
                  }
                : null,
        meeting:
            row.doc.meetingId && row.meetingTitle && row.meetingStatus
                ? {
                      id: row.doc.meetingId,
                      title: row.meetingTitle,
                      status: row.meetingStatus,
                  }
                : null,
        driveFileId: row.doc.driveFileId,
        drivePathDisplay,
        webViewLink: row.doc.webViewLink,
        previewEmbedUrl: buildSafeDrivePreviewUrl({
            driveFileId: row.doc.driveFileId,
            webViewLink: row.doc.webViewLink,
            storageMode: row.doc.storageMode,
        }),
        originalFilename: row.doc.originalFilename,
        mimeType: row.doc.mimeType,
        fileSizeBytes: row.doc.fileSizeBytes,
        uploadedBy: actorMap.get(row.doc.uploadedBy) ?? null,
        approvedBy: row.doc.approvedBy ? (actorMap.get(row.doc.approvedBy) ?? null) : null,
        approvedAt: row.doc.approvedAt ? row.doc.approvedAt.toISOString() : null,
        createdAt: row.doc.createdAt.toISOString(),
        updatedAt: row.doc.updatedAt.toISOString(),
    };
}

async function batchLoadActors(
    executor: DbExecutor,
    rows: RawDocumentJoinRow[],
): Promise<Map<string, DocumentActorSummary>> {
    const actorMap = new Map<string, DocumentActorSummary>();
    const ids = Array.from(
        new Set(
            rows
                .flatMap((r) => [r.doc.uploadedBy, r.doc.approvedBy])
                .filter((id): id is string => Boolean(id)),
        ),
    );
    if (ids.length === 0) {
        return actorMap;
    }

    const userRows = await executor
        .select({
            id: users.id,
            studentIdNumber: users.studentIdNumber,
            fullName: users.fullName,
        })
        .from(users)
        .where(inArray(users.id, ids));

    for (const u of userRows) {
        actorMap.set(u.id, u);
    }
    return actorMap;
}

export async function loadDocumentByIdWithContext(
    executor: DbExecutor,
    documentId: string,
): Promise<{
    dto: DocumentDto;
    raw: typeof documents.$inferSelect;
    termStatus: "DRAFT" | "ACTIVE" | "CLOSED";
    eventStatus?:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "NEEDS_REVISION"
        | "REJECTED"
        | "APPROVED"
        | "PUBLISHED"
        | "COMPLETED";
    meetingStatus?: "SCHEDULED" | "ONGOING" | "COMPLETED" | "CANCELLED";
} | null> {
    const [row] = await executor
        .select({
            doc: documents,
            termCode: academicTerms.code,
            termName: academicTerms.name,
            termStatus: academicTerms.status,
            docTypeName: documentTypes.name,
            docTypeSlug: documentTypes.slug,
            docTypeSegment: documentTypes.driveFolderSegment,
            eventTitle: events.title,
            eventSlug: events.slug,
            eventStatus: events.status,
            meetingTitle: meetings.title,
            meetingStatus: meetings.status,
            cachePathKey: driveFolderCache.pathKey,
        })
        .from(documents)
        .innerJoin(academicTerms, eq(documents.academicTermId, academicTerms.id))
        .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
        .leftJoin(events, eq(documents.eventId, events.id))
        .leftJoin(meetings, eq(documents.meetingId, meetings.id))
        .leftJoin(driveFolderCache, eq(documents.driveFolderCacheId, driveFolderCache.id))
        .where(eq(documents.id, documentId))
        .limit(1);

    if (!row) {
        return null;
    }

    const actorMap = await batchLoadActors(executor, [row]);
    return {
        dto: mapRawRowToDto(row, actorMap),
        raw: row.doc,
        termStatus: row.termStatus,
        eventStatus: row.eventStatus ?? undefined,
        meetingStatus: row.meetingStatus ?? undefined,
    };
}

export function buildDocumentListConditions(
    filter: Partial<DocumentsListQuery>,
): SQL[] {
    const conditions: SQL[] = [];
    if (filter.academicTermId) {
        conditions.push(eq(documents.academicTermId, filter.academicTermId));
    }
    if (filter.documentTypeId) {
        conditions.push(eq(documents.documentTypeId, filter.documentTypeId));
    }
    if (filter.eventId) {
        conditions.push(eq(documents.eventId, filter.eventId));
    }
    if (filter.meetingId) {
        conditions.push(eq(documents.meetingId, filter.meetingId));
    }
    if (filter.status) {
        conditions.push(eq(documents.status, filter.status));
    }
    if (filter.storageMode) {
        conditions.push(eq(documents.storageMode, filter.storageMode));
    }
    if (filter.q) {
        const pattern = `%${escapeLikePattern(filter.q)}%`;
        const searchExpr = or(
            ilike(documents.title, pattern),
            ilike(documents.originalFilename, pattern),
            ilike(documentTypes.name, pattern),
            ilike(events.title, pattern),
            ilike(meetings.title, pattern),
        );
        if (searchExpr) {
            conditions.push(searchExpr);
        }
    }
    if (filter.from) {
        conditions.push(gte(documents.createdAt, manilaDayStartUtc(filter.from)));
    }
    if (filter.to) {
        conditions.push(lt(documents.createdAt, manilaNextDayStartUtc(filter.to)));
    }
    return conditions;
}

export async function queryDocumentsList(
    executor: DbExecutor,
    filter: Partial<DocumentsListQuery> & { page: number; limit: number },
): Promise<{ items: DocumentDto[]; total: number }> {
    const conditions = buildDocumentListConditions(filter);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (filter.page - 1) * filter.limit;

    const [[{ total }], rows] = await Promise.all([
        executor
            .select({ total: count() })
            .from(documents)
            .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
            .leftJoin(events, eq(documents.eventId, events.id))
            .leftJoin(meetings, eq(documents.meetingId, meetings.id))
            .where(whereClause),
        executor
            .select({
                doc: documents,
                termCode: academicTerms.code,
                termName: academicTerms.name,
                termStatus: academicTerms.status,
                docTypeName: documentTypes.name,
                docTypeSlug: documentTypes.slug,
                docTypeSegment: documentTypes.driveFolderSegment,
                eventTitle: events.title,
                eventSlug: events.slug,
                eventStatus: events.status,
                meetingTitle: meetings.title,
                meetingStatus: meetings.status,
                cachePathKey: driveFolderCache.pathKey,
            })
            .from(documents)
            .innerJoin(academicTerms, eq(documents.academicTermId, academicTerms.id))
            .innerJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
            .leftJoin(events, eq(documents.eventId, events.id))
            .leftJoin(meetings, eq(documents.meetingId, meetings.id))
            .leftJoin(driveFolderCache, eq(documents.driveFolderCacheId, driveFolderCache.id))
            .where(whereClause)
            .orderBy(desc(documents.createdAt), desc(documents.id))
            .limit(filter.limit)
            .offset(offset),
    ]);

    const actorMap = await batchLoadActors(executor, rows);
    return {
        items: rows.map((row) => mapRawRowToDto(row, actorMap)),
        total: Number(total),
    };
}

export async function loadActiveDocumentTypesForUpload(
    executor: DbExecutor,
): Promise<ActiveDocumentTypeOption[]> {
    return executor
        .select({
            id: documentTypes.id,
            name: documentTypes.name,
            slug: documentTypes.slug,
            driveFolderSegment: documentTypes.driveFolderSegment,
        })
        .from(documentTypes)
        .where(eq(documentTypes.isActive, true))
        .orderBy(asc(documentTypes.name));
}

export async function loadDocumentMetadataOptions(
    executor: DbExecutor,
    eventId?: string,
): Promise<{
    documentTypes: ActiveDocumentTypeOption[];
    terms: DocumentTermOption[];
    activeTerm: DocumentTermOption | null;
    events: DocumentEventOption[];
    eventMeta: DocumentEventOption | null;
}> {
    const [docTypeRows, termRows, eventRows, targetEventRows] = await Promise.all([
        loadActiveDocumentTypesForUpload(executor),
        executor
            .select({
                id: academicTerms.id,
                code: academicTerms.code,
                name: academicTerms.name,
                status: academicTerms.status,
            })
            .from(academicTerms)
            .orderBy(desc(academicTerms.startDate)),
        executor
            .select({
                id: events.id,
                title: events.title,
                slug: events.slug,
                status: events.status,
                academicTermId: academicTerms.id,
                academicTermCode: academicTerms.code,
                academicTermName: academicTerms.name,
                academicTermStatus: academicTerms.status,
            })
            .from(events)
            .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
            .where(eq(academicTerms.status, "ACTIVE"))
            .orderBy(asc(events.title))
            .limit(100),
        eventId
            ? executor
                  .select({
                      id: events.id,
                      title: events.title,
                      slug: events.slug,
                      status: events.status,
                      academicTermId: academicTerms.id,
                      academicTermCode: academicTerms.code,
                      academicTermName: academicTerms.name,
                      academicTermStatus: academicTerms.status,
                  })
                  .from(events)
                  .innerJoin(academicTerms, eq(events.academicTermId, academicTerms.id))
                  .where(eq(events.id, eventId))
                  .limit(1)
            : Promise.resolve([]),
    ]);

    const activeTerm = termRows.find((t) => t.status === "ACTIVE") ?? null;
    return {
        documentTypes: docTypeRows,
        terms: termRows,
        activeTerm,
        events: eventRows,
        eventMeta: targetEventRows[0] ?? null,
    };
}
