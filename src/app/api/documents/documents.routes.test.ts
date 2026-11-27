import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    academicTerms,
    auditLogs,
    documents,
    documentTypes,
    driveFolderCache,
    events,
    officerAppointments,
    rateLimitBuckets,
    userSessions,
    users,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getMockDriveProvider, setDriveProviderOverrideForTest } from "@/lib/drive/adapter";
import { ensureDriveFolderHierarchy } from "@/lib/drive/client";
import { resolveDriveFolderPath } from "@/lib/drive/classifier";

const cookieJar = vi.hoisted(() => ({
    value: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) =>
            name === SESSION_COOKIE_NAME && cookieJar.value
                ? { name, value: cookieJar.value }
                : undefined,
    }),
}));

import { GET as documentByIdGet, PATCH as documentByIdPatch } from "./[id]/route";
import { POST as externalPost } from "./external/route";
import { PUT as mockUploadPut } from "./mock-upload/route";
import { GET as documentsGet } from "./route";
import { POST as uploadFinalizePost } from "./upload-finalize/route";
import { POST as uploadInitPost } from "./upload-init/route";

const directUrl = process.env.DIRECT_DATABASE_URL;

function makeJsonRequest(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
    options?: { origin?: string | null },
) {
    const headers = new Headers();
    if (body !== undefined) {
        headers.set("content-type", "application/json");
    }
    if (options?.origin !== null && method !== "GET") {
        headers.set("origin", options?.origin ?? "http://localhost:3000");
    }
    return new Request(`http://localhost:3000${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function makePutBinaryRequest(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options?: { origin?: string | null },
) {
    const headers = new Headers();
    headers.set("content-type", contentType);
    if (options?.origin !== null) {
        headers.set("origin", options?.origin ?? "http://localhost:3000");
    }
    return new Request(`http://localhost:3000${path}`, {
        method: "PUT",
        headers,
        body: Buffer.from(bytes),
    });
}

describe.skipIf(!directUrl)("M4A Google Drive & Documents routes (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    const createdDocumentIds: string[] = [];
    const createdFolderCacheIds: string[] = [];
    const createdRateLimitKeys: string[] = [];

    let activeTermId = "";
    let activeTermCode = "";
    let activeTermName = "";
    let commLetterTypeId = "";

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });

        const [activeTerm] = await conn.db
            .select({
                id: academicTerms.id,
                code: academicTerms.code,
                name: academicTerms.name,
            })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            throw new Error("Expected an ACTIVE academic term for M4A Documents integration tests.");
        }
        activeTermId = activeTerm.id;
        activeTermCode = activeTerm.code;
        activeTermName = activeTerm.name;

        const [docType] = await conn.db
            .select({ id: documentTypes.id })
            .from(documentTypes)
            .where(eq(documentTypes.slug, "communication-letters"))
            .limit(1);

        if (!docType) {
            throw new Error("Expected seeded communication-letters document type.");
        }
        commLetterTypeId = docType.id;
    });

    beforeEach(() => {
        cookieJar.value = undefined;
        const mockDrive = getMockDriveProvider();
        mockDrive.reset("mock-root-folder");
        setDriveProviderOverrideForTest(mockDrive);
    });

    afterAll(async () => {
        setDriveProviderOverrideForTest(null);
        if (createdDocumentIds.length > 0) {
            await conn.db.delete(documents).where(inArray(documents.id, createdDocumentIds));
        }
        if (createdFolderCacheIds.length > 0) {
            await conn.db
                .delete(driveFolderCache)
                .where(inArray(driveFolderCache.id, createdFolderCacheIds));
        }
        if (createdRateLimitKeys.length > 0) {
            await conn.db
                .delete(rateLimitBuckets)
                .where(inArray(rateLimitBuckets.key, createdRateLimitKeys));
        }
        if (createdUserIds.length > 0) {
            await conn.db
                .delete(userSessions)
                .where(inArray(userSessions.userId, createdUserIds));
        }
        await conn.client.end();
    });

    async function createTestUser(
        role: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER",
        status: "ACTIVE" | "DISABLED" | "NEEDS_REVIEW" = "ACTIVE",
    ) {
        const studentId = `M4D-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = "Navarro";
        const passwordHash = await hashPassword(normalizeDefaultPassword(lastName, studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "DriveTest",
                lastName,
                fullName: `DriveTest ${studentId}`,
                universityEmail: `${studentId.toLowerCase()}@hnu.edu.ph`,
                emailVerifiedAt: new Date(),
                passwordHash,
                mustChangePassword: false,
                systemRole: role,
                accountStatus: status,
                disabledAt: status === "DISABLED" ? new Date() : null,
            })
            .returning();

        createdUserIds.push(user.id);

        if (role === "OFFICER" || role === "EXECUTIVE") {
            await conn.db.insert(officerAppointments).values({
                userId: user.id,
                academicTermId: activeTermId,
                positionTitle: role === "EXECUTIVE" ? "VP Internal" : "Secretary",
                grantedSystemRole: role,
                isCurrent: true,
                appointedBy: user.id,
            });
        }

        const session = await createSession(conn.db, {
            userId: user.id,
            roleTierSnapshot: role,
        });
        return { user, token: session.token };
    }

    async function createTestEvent(
        creatorId: string,
        options?: {
            termId?: string;
            status?: "DRAFT" | "APPROVED" | "PUBLISHED" | "COMPLETED";
            title?: string;
        },
    ) {
        const slug = `m4d-event-${randomUUID().slice(0, 8)}`;
        const status = options?.status ?? "PUBLISHED";
        const now = new Date();
        const [eventRow] = await conn.db
            .insert(events)
            .values({
                academicTermId: options?.termId ?? activeTermId,
                title: options?.title ?? `M4D Event ${slug}`,
                slug,
                descriptionHtml: "<p>Event description</p>",
                startAt: now,
                endAt: new Date(now.getTime() + 3_600_000),
                status,
                createdBy: creatorId,
                publishedBy: status === "PUBLISHED" || status === "COMPLETED" ? creatorId : null,
                publishedAt: status === "PUBLISHED" || status === "COMPLETED" ? now : null,
                completedBy: status === "COMPLETED" ? creatorId : null,
                completedAt: status === "COMPLETED" ? now : null,
            })
            .returning();
        return eventRow;
    }

    async function runThreePhaseUpload(
        token: string,
        initPayload: Record<string, unknown>,
        fileBytes: Uint8Array,
    ) {
        cookieJar.value = token;
        const initRes = await uploadInitPost(
            makeJsonRequest("/api/documents/upload-init", "POST", initPayload),
        );
        const initJson = (await initRes.json()) as {
            data?: {
                uploadUrl: string;
                uploadIntentToken: string;
                folderCacheId: string;
                drivePathDisplay: string;
            };
            error?: { code: string; message: string };
        };
        if (!initRes.ok || !initJson.data) {
            return {
                stage: "init" as const,
                status: initRes.status,
                driveFileId: undefined,
                document: undefined,
                error: initJson.error,
            };
        }
        createdFolderCacheIds.push(initJson.data.folderCacheId);

        const putRes = await mockUploadPut(
            makePutBinaryRequest(
                initJson.data.uploadUrl,
                fileBytes,
                String(initPayload.mimeType),
            ),
        );
        const putJson = (await putRes.json()) as {
            data?: { id: string };
            error?: { code: string; message: string };
        };
        if (!putRes.ok || !putJson.data) {
            return {
                stage: "put" as const,
                status: putRes.status,
                driveFileId: undefined,
                document: undefined,
                error: putJson.error,
            };
        }

        const finalizeRes = await uploadFinalizePost(
            makeJsonRequest("/api/documents/upload-finalize", "POST", {
                driveFileId: putJson.data.id,
                uploadIntentToken: initJson.data.uploadIntentToken,
                ...(initPayload.breakGlass ? { breakGlass: initPayload.breakGlass } : {}),
                ...(initPayload.reason ? { reason: initPayload.reason } : {}),
            }),
        );
        const finalizeJson = (await finalizeRes.json()) as {
            data?: { document: { id: string; driveFileId: string; drivePathDisplay: string; status: string } };
            error?: { code: string; message: string };
        };
        if (finalizeRes.ok && finalizeJson.data?.document) {
            createdDocumentIds.push(finalizeJson.data.document.id);
        }
        return {
            stage: "finalize" as const,
            status: finalizeRes.status,
            initData: initJson.data,
            driveFileId: putJson.data.id,
            document: finalizeJson.data?.document,
            error: finalizeJson.error,
        };
    }

    it("AC-09: executes 3-phase upload routing for proposal, event-linked, and general docs + domain permissions", async () => {
        const officer = await createTestUser("OFFICER");
        const eventRow = await createTestEvent(officer.user.id, {
            status: "DRAFT",
            title: "Tech Summit 2026",
        });

        // 1. Proposal attachment -> Term / Proposals / Event
        const proposalRes = await runThreePhaseUpload(
            officer.token,
            {
                title: "Tech Summit Proposal PDF",
                documentTypeId: commLetterTypeId,
                eventId: eventRow.id,
                isProposalAttachment: true,
                initialStatus: "DRAFT",
                filename: "proposal.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 128,
            },
            Buffer.from("%PDF-1.7\nProposal content"),
        );
        expect(proposalRes.status).toBe(201);
        expect(proposalRes.document?.drivePathDisplay).toBe(
            `${activeTermName} / Proposals / Tech Summit 2026`,
        );

        // Verify domain permission applied on Drive
        const mockDrive = getMockDriveProvider();
        const perms = mockDrive.getFilePermissions(proposalRes.driveFileId!);
        expect(perms).toEqual([
            {
                type: "domain",
                domain: process.env.UNIVERSITY_EMAIL_DOMAIN?.toLowerCase() ?? "hnu.edu.ph",
                role: "reader",
                allowFileDiscovery: false,
            },
        ]);

        // 2. Event-linked non-proposal doc -> Term / DocumentType / Event
        const eventDocRes = await runThreePhaseUpload(
            officer.token,
            {
                title: "Venue Request Letter",
                documentTypeId: commLetterTypeId,
                eventId: eventRow.id,
                isProposalAttachment: false,
                initialStatus: "FOR_REVIEW",
                filename: "venue-letter.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 96,
            },
            Buffer.from("%PDF-1.7\nVenue letter"),
        );
        expect(eventDocRes.status).toBe(201);
        expect(eventDocRes.document?.drivePathDisplay).toBe(
            `${activeTermName} / Communication Letters / Tech Summit 2026`,
        );

        // 3. Unlinked general doc -> Term / DocumentType / General
        const generalDocRes = await runThreePhaseUpload(
            officer.token,
            {
                title: "General Partnership Letter",
                documentTypeId: commLetterTypeId,
                isProposalAttachment: false,
                initialStatus: "DRAFT",
                filename: "partner.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 80,
            },
            Buffer.from("%PDF-1.7\nGeneral"),
        );
        expect(generalDocRes.status).toBe(201);
        expect(generalDocRes.document?.drivePathDisplay).toBe(
            `${activeTermName} / Communication Letters / General`,
        );
    });

    it("recovers from trashed cached Drive folders and handles concurrent ensureDriveFolderHierarchy cleanly", async () => {
        const mockDrive = getMockDriveProvider();
        const uniqueSlug = `m4d-race-${randomUUID().slice(0, 8)}`;
        const resolved = resolveDriveFolderPath({
            academicTermName: activeTermName,
            academicTermCode: activeTermCode,
            documentTypeSegment: `Type ${uniqueSlug}`,
            documentTypeSlug: uniqueSlug,
        });

        const [first, second] = await Promise.all([
            ensureDriveFolderHierarchy(conn.db, mockDrive, {
                academicTermId: activeTermId,
                path: resolved,
            }),
            ensureDriveFolderHierarchy(conn.db, mockDrive, {
                academicTermId: activeTermId,
                path: resolved,
            }),
        ]);
        createdFolderCacheIds.push(first.folderCacheId);
        expect(first.driveFolderId).toBe(second.driveFolderId);

        // Trash the cached folder and verify self-healing recreates a fresh Drive folder ID
        mockDrive.trashFolder(first.driveFolderId);
        const healed = await ensureDriveFolderHierarchy(conn.db, mockDrive, {
            academicTermId: activeTermId,
            path: resolved,
        });
        expect(healed.folderCacheId).toBe(first.folderCacheId);
        expect(healed.driveFolderId).not.toBe(first.driveFolderId);
    });

    it("BR-DOC-03: cleans up orphaned Drive files on signature mismatch or DB/permission error and audits cleanup failures", async () => {
        const officer = await createTestUser("OFFICER");
        const mockDrive = getMockDriveProvider();

        // Spoofed MZ executable renamed to .pdf
        const spoofed = await runThreePhaseUpload(
            officer.token,
            {
                title: "Spoofed Executable",
                documentTypeId: commLetterTypeId,
                filename: "malicious.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 64,
            },
            Buffer.from("MZ\x90\x00not-a-pdf"),
        );
        expect(spoofed.stage).toBe("finalize");
        expect(spoofed.status).toBe(400);
        expect(spoofed.error?.code).toBe("INVALID_FILE_SIGNATURE");
        expect(mockDrive.hasFile(spoofed.driveFileId!)).toBe(false);

        // Simulate Drive permission failure followed by cleanup failure -> logs DOCUMENT_ORPHAN_CLEANUP_FAILED
        mockDrive.setFailureHooks({ failSetPermissionOnce: true, failDeleteOnce: true });
        const failedCleanup = await runThreePhaseUpload(
            officer.token,
            {
                title: "Cleanup Audit Test",
                documentTypeId: commLetterTypeId,
                filename: "valid.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 64,
            },
            Buffer.from("%PDF-1.7\nValid PDF"),
        );
        expect(failedCleanup.status).toBe(502);

        const [cleanupAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.actorId, officer.user.id),
                    eq(auditLogs.action, "DOCUMENT_ORPHAN_CLEANUP_FAILED"),
                ),
            )
            .orderBy(desc(auditLogs.createdAt))
            .limit(1);
        expect(cleanupAudit).toBeDefined();
    });

    it("enforces mock-upload session authentication, ownership, and production disablement", async () => {
        const officerA = await createTestUser("OFFICER");
        const officerB = await createTestUser("OFFICER");
        const member = await createTestUser("MEMBER");

        cookieJar.value = officerA.token;
        const initRes = await uploadInitPost(
            makeJsonRequest("/api/documents/upload-init", "POST", {
                title: "Mock Auth Test",
                documentTypeId: commLetterTypeId,
                filename: "doc.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 32,
            }),
        );
        const initJson = (await initRes.json()) as {
            data: { uploadUrl: string; folderCacheId: string };
        };
        createdFolderCacheIds.push(initJson.data.folderCacheId);

        // Unauthenticated -> 401
        cookieJar.value = undefined;
        const unauthPut = await mockUploadPut(
            makePutBinaryRequest(initJson.data.uploadUrl, Buffer.from("%PDF-1.7"), "application/pdf"),
        );
        expect(unauthPut.status).toBe(401);

        // Member -> 403
        cookieJar.value = member.token;
        const memberPut = await mockUploadPut(
            makePutBinaryRequest(initJson.data.uploadUrl, Buffer.from("%PDF-1.7"), "application/pdf"),
        );
        expect(memberPut.status).toBe(403);

        // Different officer -> 403
        cookieJar.value = officerB.token;
        const otherPut = await mockUploadPut(
            makePutBinaryRequest(initJson.data.uploadUrl, Buffer.from("%PDF-1.7"), "application/pdf"),
        );
        expect(otherPut.status).toBe(403);

        // Missing Origin -> 403
        cookieJar.value = officerA.token;
        const noOriginPut = await mockUploadPut(
            makePutBinaryRequest(initJson.data.uploadUrl, Buffer.from("%PDF-1.7"), "application/pdf", {
                origin: null,
            }),
        );
        expect(noOriginPut.status).toBe(403);

        // Production env -> 404
        vi.stubEnv("NODE_ENV", "production");
        try {
            const prodPut = await mockUploadPut(
                makePutBinaryRequest(
                    initJson.data.uploadUrl,
                    Buffer.from("%PDF-1.7"),
                    "application/pdf",
                ),
            );
            expect(prodPut.status).toBe(404);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("supports POST /api/documents/external and enforces schema parent/URL constraints", async () => {
        const officer = await createTestUser("OFFICER");
        cookieJar.value = officer.token;

        const validRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Constitution Draft Google Doc",
                documentTypeId: commLetterTypeId,
                initialStatus: "FOR_REVIEW",
                webViewLink: "https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
            }),
        );
        expect(validRes.status).toBe(201);
        const validJson = (await validRes.json()) as {
            data: { document: { id: string; storageMode: string; driveFileId: string | null } };
        };
        createdDocumentIds.push(validJson.data.document.id);
        expect(validJson.data.document.storageMode).toBe("EXTERNAL_LINK");
        expect(validJson.data.document.driveFileId).toBeNull();

        // Non-Google-Drive URL -> 400
        const badUrlRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Evil Link",
                documentTypeId: commLetterTypeId,
                webViewLink: "https://example.com/phishing.pdf",
            }),
        );
        expect(badUrlRes.status).toBe(400);

        // Proposal attachment without eventId -> 400
        const badProposalRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Orphan Proposal",
                documentTypeId: commLetterTypeId,
                isProposalAttachment: true,
                webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view",
            }),
        );
        expect(badProposalRes.status).toBe(400);

        // Both eventId and meetingId -> 400
        const bothParentsRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Dual Parent",
                documentTypeId: commLetterTypeId,
                eventId: randomUUID(),
                meetingId: randomUUID(),
                webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view",
            }),
        );
        expect(bothParentsRes.status).toBe(400);
    });

    it("enforces SEC-TEST-01 (MEMBER 403), Officer vs Executive transitions, CLOSED term 409, and SUPER_ADMIN break-glass", async () => {
        const member = await createTestUser("MEMBER");
        const officer = await createTestUser("OFFICER");
        const executive = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");

        // Officer registers an external document
        cookieJar.value = officer.token;
        const createRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Workflow Lifecycle Doc",
                documentTypeId: commLetterTypeId,
                initialStatus: "DRAFT",
                webViewLink: "https://drive.google.com/file/d/1LifecycleDocId/view",
            }),
        );
        expect(createRes.status).toBe(201);
        const docId = ((await createRes.json()) as { data: { document: { id: string } } }).data
            .document.id;
        createdDocumentIds.push(docId);

        // MEMBER blocked across all documents endpoints (403)
        cookieJar.value = member.token;
        expect((await documentsGet(makeJsonRequest("/api/documents", "GET"))).status).toBe(403);
        expect(
            (
                await documentByIdGet(makeJsonRequest(`/api/documents/${docId}`, "GET"), {
                    params: Promise.resolve({ id: docId }),
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await externalPost(
                    makeJsonRequest("/api/documents/external", "POST", {
                        title: "Blocked",
                        documentTypeId: commLetterTypeId,
                        webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view",
                    }),
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await documentByIdPatch(
                    makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "FOR_REVIEW" }),
                    { params: Promise.resolve({ id: docId }) },
                )
            ).status,
        ).toBe(403);

        // Officer moves DRAFT -> FOR_REVIEW -> SUBMITTED, but cannot APPROVE (403)
        cookieJar.value = officer.token;
        expect(
            (
                await documentByIdPatch(
                    makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "FOR_REVIEW" }),
                    { params: Promise.resolve({ id: docId }) },
                )
            ).status,
        ).toBe(200);
        expect(
            (
                await documentByIdPatch(
                    makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "SUBMITTED" }),
                    { params: Promise.resolve({ id: docId }) },
                )
            ).status,
        ).toBe(200);
        expect(
            (
                await documentByIdPatch(
                    makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "APPROVED" }),
                    { params: Promise.resolve({ id: docId }) },
                )
            ).status,
        ).toBe(403);

        // Executive approves -> sets approvedBy/approvedAt + audit log
        cookieJar.value = executive.token;
        const approveRes = await documentByIdPatch(
            makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "APPROVED" }),
            { params: Promise.resolve({ id: docId }) },
        );
        expect(approveRes.status).toBe(200);
        const approvedDto = (
            (await approveRes.json()) as {
                data: { document: { status: string; approvedBy: { id: string } | null } };
            }
        ).data.document;
        expect(approvedDto.status).toBe("APPROVED");
        expect(approvedDto.approvedBy?.id).toBe(executive.user.id);

        // SUPER_ADMIN archiving requires breakGlass + >= 10 char reason
        cookieJar.value = superAdmin.token;
        const noBgRes = await documentByIdPatch(
            makeJsonRequest(`/api/documents/${docId}`, "PATCH", { status: "ARCHIVED" }),
            { params: Promise.resolve({ id: docId }) },
        );
        expect(noBgRes.status).toBe(400);

        const withBgRes = await documentByIdPatch(
            makeJsonRequest(`/api/documents/${docId}`, "PATCH", {
                status: "ARCHIVED",
                breakGlass: true,
                reason: "Archiving superseded document per President directive.",
            }),
            { params: Promise.resolve({ id: docId }) },
        );
        expect(withBgRes.status).toBe(200);

        // Archived document is terminal -> 409
        const afterArchiveRes = await documentByIdPatch(
            makeJsonRequest(`/api/documents/${docId}`, "PATCH", {
                title: "Mutate Archived",
                breakGlass: true,
                reason: "Testing archived lock immutability.",
            }),
            { params: Promise.resolve({ id: docId }) },
        );
        expect(afterArchiveRes.status).toBe(409);

        // CLOSED academic term returns 409 RESOURCE_LOCKED for Executive, overridable via SUPER_ADMIN BG
        const closedCode = `M4D-CLOSED-${randomUUID().slice(0, 8)}`;
        const [closedTerm] = await conn.db
            .insert(academicTerms)
            .values({
                code: closedCode,
                name: `Closed Term ${closedCode}`,
                startDate: "2025-08-01",
                endDate: "2025-12-20",
                status: "CLOSED",
                closedAt: new Date(),
                createdBy: superAdmin.user.id,
            })
            .returning();

        const closedEvent = await createTestEvent(executive.user.id, {
            termId: closedTerm.id,
            status: "PUBLISHED",
        });

        cookieJar.value = executive.token;
        const lockedExternalRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Blocked Closed Term Doc",
                documentTypeId: commLetterTypeId,
                eventId: closedEvent.id,
                webViewLink: "https://drive.google.com/file/d/1ClosedTermDoc/view",
            }),
        );
        expect(lockedExternalRes.status).toBe(409);

        cookieJar.value = superAdmin.token;
        const bgClosedRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Historical Addendum",
                documentTypeId: commLetterTypeId,
                eventId: closedEvent.id,
                webViewLink: "https://drive.google.com/file/d/1ClosedTermDoc/view",
                breakGlass: true,
                reason: "Adding late signed archival addendum to closed semester.",
            }),
        );
        expect(bgClosedRes.status).toBe(201);
        const bgDocId = ((await bgClosedRes.json()) as { data: { document: { id: string } } }).data
            .document.id;
        createdDocumentIds.push(bgDocId);

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "document"),
                    eq(auditLogs.entityId, bgDocId),
                    eq(auditLogs.action, "DOCUMENT_EXTERNAL_LINKED"),
                ),
            )
            .limit(1);
        expect(bgAudit).toBeDefined();
        expect((bgAudit.afterState as Record<string, unknown> | null)?.break_glass).toBe(true);
    });

    it("enforces CSRF Origin check and 429 rate limiting on upload endpoints", async () => {
        const officer = await createTestUser("OFFICER");
        cookieJar.value = officer.token;
        createdRateLimitKeys.push(`doc:external:user:${officer.user.id}`);

        const noOrigin = await externalPost(
            makeJsonRequest(
                "/api/documents/external",
                "POST",
                {
                    title: "CSRF Test",
                    documentTypeId: commLetterTypeId,
                    webViewLink: "https://drive.google.com/file/d/1CsrfTest/view",
                },
                { origin: null },
            ),
        );
        expect(noOrigin.status).toBe(403);

        // Pre-fill rate limit bucket to 30 to verify 429 + Retry-After
        await conn.db.insert(rateLimitBuckets).values({
            key: `doc:external:user:${officer.user.id}`,
            count: 30,
            windowExpiresAt: new Date(Date.now() + 60_000),
            updatedAt: new Date(),
        });

        const limitedRes = await externalPost(
            makeJsonRequest("/api/documents/external", "POST", {
                title: "Rate Limited",
                documentTypeId: commLetterTypeId,
                webViewLink: "https://drive.google.com/file/d/1RateLimit/view",
            }),
        );
        expect(limitedRes.status).toBe(429);
        expect(limitedRes.headers.get("Retry-After")).toBeTruthy();
    });
});
