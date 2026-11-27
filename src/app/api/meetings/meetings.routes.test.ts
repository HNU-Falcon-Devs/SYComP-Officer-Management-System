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
    meetings,
    officerAppointments,
    rateLimitBuckets,
    userSessions,
    users,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getMockDriveProvider, setDriveProviderOverrideForTest } from "@/lib/drive/adapter";

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

import { POST as checkpointsPost } from "../attendance/checkpoints/route";
import { PATCH as checkpointPatch } from "../attendance/checkpoints/[id]/route";
import { GET as attendanceExportGet } from "../attendance/export/route";
import { POST as attendanceOverridePost } from "../attendance/override/route";
import { PUT as mockUploadPut } from "../documents/mock-upload/route";
import { POST as uploadFinalizePost } from "../documents/upload-finalize/route";
import { POST as uploadInitPost } from "../documents/upload-init/route";
import { PATCH as minutesPatch } from "./[id]/minutes/route";
import { GET as meetingByIdGet, PATCH as meetingByIdPatch } from "./[id]/route";
import { GET as meetingsGet, POST as meetingsPost } from "./route";

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

describe.skipIf(!directUrl)("M4A Officer Meetings routes (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    const createdDocumentIds: string[] = [];
    const createdFolderCacheIds: string[] = [];
    const createdRateLimitKeys: string[] = [];

    let activeTermId = "";
    let activeTermName = "";
    let minutesDocTypeId = "";

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });

        const [activeTerm] = await conn.db
            .select({
                id: academicTerms.id,
                name: academicTerms.name,
            })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            throw new Error("Expected an ACTIVE academic term for M4A Meetings tests.");
        }
        activeTermId = activeTerm.id;
        activeTermName = activeTerm.name;

        const [minutesType] = await conn.db
            .select({ id: documentTypes.id })
            .from(documentTypes)
            .where(eq(documentTypes.slug, "minutes"))
            .limit(1);

        if (!minutesType) {
            throw new Error("Expected seeded minutes document type.");
        }
        minutesDocTypeId = minutesType.id;
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
        options?: { withAppointment?: boolean },
    ) {
        const studentId = `M4M-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = "Villanueva";
        const passwordHash = await hashPassword(normalizeDefaultPassword(lastName, studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "MeetingTest",
                lastName,
                fullName: `MeetingTest ${studentId}`,
                universityEmail: `${studentId.toLowerCase()}@hnu.edu.ph`,
                emailVerifiedAt: new Date(),
                passwordHash,
                mustChangePassword: false,
                systemRole: role,
                accountStatus: "ACTIVE",
            })
            .returning();

        createdUserIds.push(user.id);

        const shouldAppoint =
            options?.withAppointment ?? (role === "OFFICER" || role === "EXECUTIVE");
        if (shouldAppoint && (role === "OFFICER" || role === "EXECUTIVE")) {
            await conn.db.insert(officerAppointments).values({
                userId: user.id,
                academicTermId: activeTermId,
                positionTitle: role === "EXECUTIVE" ? "President" : "Secretary",
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

    it("enforces BR-MTG-01 member isolation (403), Executive scheduling, XSS sanitization, and Stage 5 active-appointment minutes editing", async () => {
        const member = await createTestUser("MEMBER");
        const activeOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const unappointedOfficer = await createTestUser("OFFICER", { withAppointment: false });
        const executive = await createTestUser("EXECUTIVE");

        // EXECUTIVE schedules meeting with XSS attempt in agendaHtml
        cookieJar.value = executive.token;
        const createRes = await meetingsPost(
            makeJsonRequest("/api/meetings", "POST", {
                title: "1st Officers Assembly",
                scheduledStartAt: "2026-10-18T09:00:00+08:00",
                scheduledEndAt: "2026-10-18T11:00:00+08:00",
                locationOrLink: "CCS Conference Room",
                agendaHtml: '<h2>Agenda</h2><script>alert("xss")</script><p>Roll call</p>',
            }),
        );
        expect(createRes.status).toBe(201);
        const createdJson = (await createRes.json()) as {
            data: { meeting: { id: string; status: string; agendaHtml: string | null } };
        };
        const meetingId = createdJson.data.meeting.id;
        expect(createdJson.data.meeting.status).toBe("SCHEDULED");
        expect(createdJson.data.meeting.agendaHtml).toContain("<h2>Agenda</h2>");
        expect(createdJson.data.meeting.agendaHtml).not.toContain("<script");

        // MEMBER receives hard 403 across all /api/meetings/* endpoints
        cookieJar.value = member.token;
        expect((await meetingsGet(makeJsonRequest("/api/meetings", "GET"))).status).toBe(403);
        expect(
            (
                await meetingsPost(
                    makeJsonRequest("/api/meetings", "POST", {
                        title: "Blocked",
                        scheduledStartAt: "2026-10-18T09:00:00+08:00",
                    }),
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await meetingByIdGet(makeJsonRequest(`/api/meetings/${meetingId}`, "GET"), {
                    params: Promise.resolve({ id: meetingId }),
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await meetingByIdPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "ONGOING" }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await minutesPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                        minutesHtml: "<p>Blocked</p>",
                    }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(403);

        // OFFICER cannot schedule or transition meetings (403)
        cookieJar.value = activeOfficer.token;
        expect(
            (
                await meetingsPost(
                    makeJsonRequest("/api/meetings", "POST", {
                        title: "Officer Blocked",
                        scheduledStartAt: "2026-10-18T09:00:00+08:00",
                    }),
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await meetingByIdPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "ONGOING" }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(403);

        // OFFICER without active term appointment is blocked by Stage 5 (403 INACTIVE_APPOINTMENT)
        cookieJar.value = unappointedOfficer.token;
        const inactiveMinutesRes = await minutesPatch(
            makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                minutesHtml: "<p>Unauthorized minutes</p>",
            }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(inactiveMinutesRes.status).toBe(403);

        // Active-term OFFICER can edit Minutes of Meeting with XSS stripped + audit logged
        cookieJar.value = activeOfficer.token;
        const minutesRes = await minutesPatch(
            makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                minutesHtml:
                    '<p>Approved budget</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
            }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(minutesRes.status).toBe(200);
        const minutesJson = (await minutesRes.json()) as {
            data: { meeting: { minutesHtml: string | null; hasMinutes: boolean } };
        };
        expect(minutesJson.data.meeting.hasMinutes).toBe(true);
        expect(minutesJson.data.meeting.minutesHtml).toContain("<p>Approved budget</p>");
        expect(minutesJson.data.meeting.minutesHtml).not.toContain("onerror");
        expect(minutesJson.data.meeting.minutesHtml).not.toContain("javascript:");
    });

    it("enforces meeting lifecycle transitions, open-checkpoint completion block, OFFICERS_ONLY attendance, CSV export, Minutes Drive attachment, and break-glass", async () => {
        const executive = await createTestUser("EXECUTIVE");
        const officer = await createTestUser("OFFICER", { withAppointment: true });
        const superAdmin = await createTestUser("SUPER_ADMIN");

        // Executive creates and starts a meeting
        cookieJar.value = executive.token;
        const createRes = await meetingsPost(
            makeJsonRequest("/api/meetings", "POST", {
                title: "Midterm Planning Meeting",
                scheduledStartAt: "2026-10-20T14:00:00+08:00",
            }),
        );
        const meetingId = ((await createRes.json()) as { data: { meeting: { id: string } } }).data
            .meeting.id;

        const startRes = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "ONGOING" }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(startRes.status).toBe(200);

        // Create and open an OFFICERS_ONLY meeting checkpoint via M3A endpoint
        const cpRes = await checkpointsPost(
            makeJsonRequest("/api/attendance/checkpoints", "POST", {
                meetingId,
                label: "Officer Roll Call",
                audienceScope: "OFFICERS_ONLY",
                sortOrder: 1,
            }),
        );
        expect(cpRes.status).toBe(201);
        const checkpointId = ((await cpRes.json()) as { data: { checkpoint: { id: string } } }).data
            .checkpoint.id;

        const openCpRes = await checkpointPatch(
            makeJsonRequest(`/api/attendance/checkpoints/${checkpointId}`, "PATCH", {
                status: "OPEN",
            }),
            { params: Promise.resolve({ id: checkpointId }) },
        );
        expect(openCpRes.status).toBe(200);

        // Executive logs officer attendance manually and exports formula-safe CSV
        const logRes = await attendanceOverridePost(
            makeJsonRequest("/api/attendance/override", "POST", {
                checkpointId,
                studentIdNumber: officer.user.studentIdNumber,
                status: "PRESENT",
                editReason: "Present at roll call",
            }),
        );
        expect(logRes.status).toBe(201);

        const csvRes = await attendanceExportGet(
            makeJsonRequest(`/api/attendance/export?meetingId=${meetingId}`, "GET"),
        );
        expect(csvRes.status).toBe(200);
        expect(csvRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(csvRes.headers.get("Cache-Control")).toBe("no-store");
        expect(await csvRes.text()).toContain(officer.user.studentIdNumber);

        // Upload Minutes attachment via M4A 3-phase Drive upload bound to meetingId -> Term / Minutes / General
        cookieJar.value = officer.token;
        const initRes = await uploadInitPost(
            makeJsonRequest("/api/documents/upload-init", "POST", {
                title: "Midterm Planning Minutes PDF",
                documentTypeId: minutesDocTypeId,
                meetingId,
                initialStatus: "FOR_REVIEW",
                filename: "minutes.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 64,
            }),
        );
        expect(initRes.status).toBe(200);
        const initJson = (await initRes.json()) as {
            data: {
                uploadUrl: string;
                uploadIntentToken: string;
                folderCacheId: string;
                drivePathDisplay: string;
            };
        };
        createdFolderCacheIds.push(initJson.data.folderCacheId);
        expect(initJson.data.drivePathDisplay).toBe(`${activeTermName} / Minutes / General`);

        const putRes = await mockUploadPut(
            new Request(`http://localhost:3000${initJson.data.uploadUrl}`, {
                method: "PUT",
                headers: {
                    "content-type": "application/pdf",
                    origin: "http://localhost:3000",
                },
                body: Buffer.from("%PDF-1.7\nMeeting minutes"),
            }),
        );
        const putJson = (await putRes.json()) as { data: { id: string } };
        const finRes = await uploadFinalizePost(
            makeJsonRequest("/api/documents/upload-finalize", "POST", {
                driveFileId: putJson.data.id,
                uploadIntentToken: initJson.data.uploadIntentToken,
            }),
        );
        expect(finRes.status).toBe(201);
        const uploadedDocId = (
            (await finRes.json()) as { data: { document: { id: string } } }
        ).data.document.id;
        createdDocumentIds.push(uploadedDocId);

        // GET /api/meetings/[id] returns meeting, checkpoints, and attached documents
        const detailRes = await meetingByIdGet(
            makeJsonRequest(`/api/meetings/${meetingId}`, "GET"),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(detailRes.status).toBe(200);
        const detailJson = (await detailRes.json()) as {
            data: {
                checkpoints: Array<{ id: string }>;
                documents: Array<{ id: string }>;
            };
        };
        expect(detailJson.data.checkpoints.some((c) => c.id === checkpointId)).toBe(true);
        expect(detailJson.data.documents.some((d) => d.id === uploadedDocId)).toBe(true);

        // Cannot COMPLETE meeting while checkpoint is still OPEN -> 409 OPEN_CHECKPOINTS_EXIST
        cookieJar.value = executive.token;
        const blockedCompleteRes = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "COMPLETED" }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(blockedCompleteRes.status).toBe(409);
        const blockedJson = (await blockedCompleteRes.json()) as { error: { code: string } };
        expect(blockedJson.error.code).toBe("OPEN_CHECKPOINTS_EXIST");

        // Close checkpoint, then COMPLETE succeeds with completedAt set
        expect(
            (
                await checkpointPatch(
                    makeJsonRequest(`/api/attendance/checkpoints/${checkpointId}`, "PATCH", {
                        status: "CLOSED",
                    }),
                    { params: Promise.resolve({ id: checkpointId }) },
                )
            ).status,
        ).toBe(200);

        const completeRes = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "COMPLETED" }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(completeRes.status).toBe(200);
        const completedMeeting = (
            (await completeRes.json()) as {
                data: { meeting: { status: string; completedAt: string | null } };
            }
        ).data.meeting;
        expect(completedMeeting.status).toBe("COMPLETED");
        expect(completedMeeting.completedAt).toBeTruthy();

        // After COMPLETED, Officer/Executive minutes or meeting edits return 409 RESOURCE_LOCKED
        cookieJar.value = officer.token;
        expect(
            (
                await minutesPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                        minutesHtml: "<p>Late edit</p>",
                    }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(409);

        // SUPER_ADMIN requires breakGlass + >=10 char reason to edit locked meeting minutes
        cookieJar.value = superAdmin.token;
        expect(
            (
                await minutesPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                        minutesHtml: "<p>Missing BG</p>",
                    }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(400);

        const bgMinutesRes = await minutesPatch(
            makeJsonRequest(`/api/meetings/${meetingId}/minutes`, "PATCH", {
                minutesHtml: "<p>Approved addendum</p>",
                breakGlass: true,
                reason: "Adding signed secretary addendum approved by Executive Board.",
            }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(bgMinutesRes.status).toBe(200);

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "meeting"),
                    eq(auditLogs.entityId, meetingId),
                    eq(auditLogs.action, "MEETING_MINUTES_UPDATED"),
                ),
            )
            .orderBy(desc(auditLogs.createdAt))
            .limit(1);
        expect((bgAudit.afterState as Record<string, unknown> | null)?.break_glass).toBe(true);
    });

    it("enforces cancellation reason, CLOSED-term lock + break-glass, and CSRF Origin checks", async () => {
        const executive = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");

        cookieJar.value = executive.token;

        // Missing Origin -> 403 CSRF_FORBIDDEN
        const csrfRes = await meetingsPost(
            makeJsonRequest(
                "/api/meetings",
                "POST",
                {
                    title: "CSRF Test",
                    scheduledStartAt: "2026-10-22T10:00:00+08:00",
                },
                { origin: null },
            ),
        );
        expect(csrfRes.status).toBe(403);

        // Schedule meeting and test cancellation reason requirement
        const createRes = await meetingsPost(
            makeJsonRequest("/api/meetings", "POST", {
                title: "Cancellable Meeting",
                scheduledStartAt: "2026-10-22T10:00:00+08:00",
            }),
        );
        const meetingId = ((await createRes.json()) as { data: { meeting: { id: string } } }).data
            .meeting.id;

        const noReasonCancel = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", { status: "CANCELLED" }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(noReasonCancel.status).toBe(400);

        const validCancel = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", {
                status: "CANCELLED",
                reason: "Rescheduled due to university-wide typhoon suspension.",
            }),
            { params: Promise.resolve({ id: meetingId }) },
        );
        expect(validCancel.status).toBe(200);

        // Cancelled meeting is locked -> 409
        expect(
            (
                await meetingByIdPatch(
                    makeJsonRequest(`/api/meetings/${meetingId}`, "PATCH", {
                        title: "Edit Cancelled",
                    }),
                    { params: Promise.resolve({ id: meetingId }) },
                )
            ).status,
        ).toBe(409);

        // CLOSED term lock on pre-existing meeting
        const closedCode = `M4M-CLOSED-${randomUUID().slice(0, 8)}`;
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

        const [closedMeeting] = await conn.db
            .insert(meetings)
            .values({
                academicTermId: closedTerm.id,
                title: "Historical Closed Term Meeting",
                scheduledStartAt: new Date("2025-09-10T02:00:00.000Z"),
                status: "SCHEDULED",
                createdBy: executive.user.id,
            })
            .returning();

        cookieJar.value = executive.token;
        expect(
            (
                await meetingByIdPatch(
                    makeJsonRequest(`/api/meetings/${closedMeeting.id}`, "PATCH", {
                        title: "Locked Edit",
                    }),
                    { params: Promise.resolve({ id: closedMeeting.id }) },
                )
            ).status,
        ).toBe(409);

        cookieJar.value = superAdmin.token;
        const bgClosedEdit = await meetingByIdPatch(
            makeJsonRequest(`/api/meetings/${closedMeeting.id}`, "PATCH", {
                title: "Historical Closed Term Meeting (Verified)",
                breakGlass: true,
                reason: "Correcting archival meeting title for closed semester record.",
            }),
            { params: Promise.resolve({ id: closedMeeting.id }) },
        );
        expect(bgClosedEdit.status).toBe(200);
    });
});
