import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    academicTerms,
    attendanceRecords,
    auditLogs,
    events,
    meetings,
    officerAppointments,
    userSessions,
    users,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { createSession, getSessionFromToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

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

import { PATCH as checkpointPatch } from "./checkpoints/[id]/route";
import { GET as checkpointsGet, POST as checkpointsPost } from "./checkpoints/route";
import { POST as confirmPost } from "./confirm/route";
import { GET as exportGet } from "./export/route";
import { GET as lookupGet } from "./lookup/route";
import { PATCH as overridePatch, POST as overridePost } from "./override/route";
import { GET as recordsGet } from "./records/route";

const directUrl = process.env.DIRECT_DATABASE_URL;

function makeRequest(
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

describe.skipIf(!directUrl)("M3A dynamic attendance & 2-step QR scanner routes (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    let activeTermId = "";

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });
        const [activeTerm] = await conn.db
            .select({ id: academicTerms.id })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            throw new Error("Expected an ACTIVE academic term for M3A integration tests.");
        }
        activeTermId = activeTerm.id;
    });

    beforeEach(() => {
        cookieJar.value = undefined;
    });

    afterAll(async () => {
        if (createdUserIds.length > 0) {
            await conn.db
                .delete(userSessions)
                .where(inArray(userSessions.userId, createdUserIds));
        }
        await conn.client.end();
    });

    async function createTestUser(
        role: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER",
        options?: {
            status?: "ACTIVE" | "DISABLED" | "NEEDS_REVIEW";
            fullName?: string;
            universityEmail?: string | null;
        },
    ) {
        const studentId = `M3A-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = "Deligero";
        const passwordHash = await hashPassword(normalizeDefaultPassword(lastName, studentId));
        const status = options?.status ?? "ACTIVE";
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "ScannerTest",
                lastName,
                fullName: options?.fullName ?? `ScannerTest ${studentId}`,
                universityEmail: options?.universityEmail ?? null,
                passwordHash,
                mustChangePassword: false,
                systemRole: role,
                accountStatus: status,
                disabledAt: status === "DISABLED" ? new Date() : null,
            })
            .returning();
        createdUserIds.push(user.id);
        return user;
    }

    async function signInAs(user: {
        id: string;
        systemRole: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER";
    }) {
        const sess = await createSession(conn.db, {
            userId: user.id,
            roleTierSnapshot: user.systemRole,
        });
        cookieJar.value = sess.token;
        return sess.token;
    }

    async function createTestEvent(
        creatorId: string,
        status: "DRAFT" | "APPROVED" | "PUBLISHED" | "COMPLETED",
        termId = activeTermId,
    ) {
        const now = new Date();
        const suffix = randomUUID().slice(0, 8).toLowerCase();
        const [ev] = await conn.db
            .insert(events)
            .values({
                academicTermId: termId,
                title: `M3A Event ${suffix}`,
                slug: `m3a-ev-${suffix}`,
                descriptionHtml: "<p>Event details</p>",
                startAt: now,
                endAt: new Date(now.getTime() + 3_600_000),
                status,
                createdBy: creatorId,
                approvedBy: status === "DRAFT" ? null : creatorId,
                approvedAt: status === "DRAFT" ? null : now,
                publishedBy: status === "PUBLISHED" || status === "COMPLETED" ? creatorId : null,
                publishedAt: status === "PUBLISHED" || status === "COMPLETED" ? now : null,
                completedBy: status === "COMPLETED" ? creatorId : null,
                completedAt: status === "COMPLETED" ? now : null,
            })
            .returning();
        return ev;
    }

    it("enforces checkpoint RBAC, meeting OFFICERS_ONLY invariant, event lifecycle gates, and break-glass", async () => {
        const member = await createTestUser("MEMBER");
        const officer = await createTestUser("OFFICER");
        const exec = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const disabledExec = await createTestUser("EXECUTIVE", { status: "DISABLED" });

        const draftEv = await createTestEvent(exec.id, "DRAFT");
        const approvedEv = await createTestEvent(exec.id, "APPROVED");
        const publishedEv = await createTestEvent(exec.id, "PUBLISHED");
        const completedEv = await createTestEvent(exec.id, "COMPLETED");

        const [meeting] = await conn.db
            .insert(meetings)
            .values({
                academicTermId: activeTermId,
                title: `M3A Meeting ${randomUUID().slice(0, 6)}`,
                scheduledStartAt: new Date(),
                status: "SCHEDULED",
                createdBy: exec.id,
            })
            .returning();

        // Unauthenticated -> 401
        expect(
            (await checkpointsGet(makeRequest("/api/attendance/checkpoints", "GET"))).status,
        ).toBe(401);

        // MEMBER denied across all attendance routes (403)
        await signInAs(member);
        expect(
            (await checkpointsGet(makeRequest("/api/attendance/checkpoints", "GET"))).status,
        ).toBe(403);
        expect(
            (
                await checkpointsPost(
                    makeRequest("/api/attendance/checkpoints", "POST", {
                        eventId: publishedEv.id,
                        label: "Denied",
                    }),
                )
            ).status,
        ).toBe(403);

        // DISABLED account -> 403 ACCOUNT_HOLD + session revoked
        const disabledToken = await signInAs(disabledExec);
        const holdRes = await checkpointsGet(makeRequest("/api/attendance/checkpoints", "GET"));
        expect(holdRes.status).toBe(403);
        expect(await holdRes.json()).toMatchObject({ error: { code: "ACCOUNT_HOLD" } });
        expect(await getSessionFromToken(conn.db, disabledToken)).toBeNull();

        // CSRF guard on POST
        await signInAs(exec);
        const csrfRes = await checkpointsPost(
            makeRequest(
                "/api/attendance/checkpoints",
                "POST",
                { eventId: publishedEv.id, label: "No Origin" },
                { origin: null },
            ),
        );
        expect(csrfRes.status).toBe(403);
        expect(await csrfRes.json()).toMatchObject({ error: { code: "CSRF_FORBIDDEN" } });

        // OFFICER cannot create/toggle checkpoints (403)
        await signInAs(officer);
        expect(
            (
                await checkpointsPost(
                    makeRequest("/api/attendance/checkpoints", "POST", {
                        eventId: publishedEv.id,
                        label: "Officer Denied",
                    }),
                )
            ).status,
        ).toBe(403);

        // EXECUTIVE guards: pre-approval event -> 409 EVENT_NOT_APPROVED
        await signInAs(exec);
        const draftCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: draftEv.id,
                label: "Too Early",
            }),
        );
        expect(draftCpRes.status).toBe(409);
        expect(await draftCpRes.json()).toMatchObject({ error: { code: "EVENT_NOT_APPROVED" } });

        // EXECUTIVE can create on APPROVED event, but cannot OPEN until PUBLISHED (409 EVENT_NOT_PUBLISHED)
        const approvedCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: approvedEv.id,
                label: "Pre-Staged",
                audienceScope: "GENERAL_MEMBERS",
            }),
        );
        expect(approvedCpRes.status).toBe(201);
        const approvedCp = (await approvedCpRes.json()).data.checkpoint;

        const openApprovedRes = await checkpointPatch(
            makeRequest(`/api/attendance/checkpoints/${approvedCp.id}`, "PATCH", {
                status: "OPEN",
            }),
            { params: Promise.resolve({ id: approvedCp.id }) },
        );
        expect(openApprovedRes.status).toBe(409);
        expect(await openApprovedRes.json()).toMatchObject({
            error: { code: "EVENT_NOT_PUBLISHED" },
        });

        // Meeting checkpoint enforces OFFICERS_ONLY on both POST and PATCH
        const badMeetingCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                meetingId: meeting.id,
                label: "Bad Scope",
                audienceScope: "ALL",
            }),
        );
        expect(badMeetingCpRes.status).toBe(400);
        expect(await badMeetingCpRes.json()).toMatchObject({
            error: { code: "INVALID_MEETING_AUDIENCE" },
        });

        const goodMeetingCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                meetingId: meeting.id,
                label: "Officer Roll Call",
            }),
        );
        expect(goodMeetingCpRes.status).toBe(201);
        const meetingCp = (await goodMeetingCpRes.json()).data.checkpoint;
        expect(meetingCp.audienceScope).toBe("OFFICERS_ONLY");

        const badMeetingPatchRes = await checkpointPatch(
            makeRequest(`/api/attendance/checkpoints/${meetingCp.id}`, "PATCH", {
                audienceScope: "GENERAL_MEMBERS",
            }),
            { params: Promise.resolve({ id: meetingCp.id }) },
        );
        expect(badMeetingPatchRes.status).toBe(400);
        expect(await badMeetingPatchRes.json()).toMatchObject({
            error: { code: "INVALID_MEETING_AUDIENCE" },
        });

        // Open meeting checkpoint & test ?forScanner=true filtering
        expect(
            (
                await checkpointPatch(
                    makeRequest(`/api/attendance/checkpoints/${meetingCp.id}`, "PATCH", {
                        status: "OPEN",
                    }),
                    { params: Promise.resolve({ id: meetingCp.id }) },
                )
            ).status,
        ).toBe(200);

        // EXECUTIVE creates & opens public event checkpoint, checks duplicate 409 & COMPLETED lock 409
        const pubCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: publishedEv.id,
                label: "AM In",
                audienceScope: "ALL",
            }),
        );
        expect(pubCpRes.status).toBe(201);
        const pubCp = (await pubCpRes.json()).data.checkpoint;

        const dupCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: publishedEv.id,
                label: "AM In",
            }),
        );
        expect(dupCpRes.status).toBe(409);
        expect(await dupCpRes.json()).toMatchObject({ error: { code: "CHECKPOINT_CONFLICT" } });

        expect(
            (
                await checkpointPatch(
                    makeRequest(`/api/attendance/checkpoints/${pubCp.id}`, "PATCH", {
                        status: "OPEN",
                    }),
                    { params: Promise.resolve({ id: pubCp.id }) },
                )
            ).status,
        ).toBe(200);

        // ?forScanner=true excludes OFFICERS_ONLY for OFFICER, includes it for EXECUTIVE
        await signInAs(officer);
        const officerScannerRes = await checkpointsGet(
            makeRequest("/api/attendance/checkpoints?forScanner=true", "GET"),
        );
        const officerScannerIds = new Set(
            ((await officerScannerRes.json()).data.checkpoints as Array<{ id: string }>).map(
                (c) => c.id,
            ),
        );
        expect(officerScannerIds.has(pubCp.id)).toBe(true);
        expect(officerScannerIds.has(meetingCp.id)).toBe(false);

        await signInAs(exec);
        const execScannerRes = await checkpointsGet(
            makeRequest("/api/attendance/checkpoints?forScanner=true", "GET"),
        );
        const execScannerIds = new Set(
            ((await execScannerRes.json()).data.checkpoints as Array<{ id: string }>).map(
                (c) => c.id,
            ),
        );
        expect(execScannerIds.has(meetingCp.id)).toBe(true);

        // COMPLETED event locks EXECUTIVE checkpoint creation (409), SUPER_ADMIN break-glass succeeds
        expect(
            (
                await checkpointsPost(
                    makeRequest("/api/attendance/checkpoints", "POST", {
                        eventId: completedEv.id,
                        label: "Locked",
                    }),
                )
            ).status,
        ).toBe(409);

        await signInAs(superAdmin);
        expect(
            (
                await checkpointsPost(
                    makeRequest("/api/attendance/checkpoints", "POST", {
                        eventId: completedEv.id,
                        label: "SA No Reason",
                    }),
                )
            ).status,
        ).toBe(400);

        const bgReason = "Retroactive checkpoint creation approved by Faculty Adviser.";
        const bgCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: completedEv.id,
                label: "Retroactive",
                breakGlass: true,
                reason: bgReason,
            }),
        );
        expect(bgCpRes.status).toBe(201);
        const bgCp = (await bgCpRes.json()).data.checkpoint;

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, bgCp.id),
                    eq(auditLogs.action, "CHECKPOINT_CREATED"),
                ),
            );
        expect(bgAudit.reason).toBe(bgReason);
        expect(bgAudit.afterState).toMatchObject({ break_glass: true });
    });

    it("executes 2-step QR lookup/confirm (AC-06, SEC-TEST-04), manual override (AC-07), and formula-safe export", async () => {
        const officer = await createTestUser("OFFICER");
        const otherOfficer = await createTestUser("OFFICER");
        const exec = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const secretEmail = `secret.student.${randomUUID().slice(0, 8).toLowerCase()}@hnu.edu.ph`;
        const memberReady = await createTestUser("MEMBER", {
            fullName: '=HYPERLINK("http://evil","Formula Student")',
            universityEmail: secretEmail,
        });
        const memberHold = await createTestUser("MEMBER", { status: "NEEDS_REVIEW" });
        const appointedMemberRole = await createTestUser("MEMBER");

        await conn.db.insert(officerAppointments).values({
            userId: appointedMemberRole.id,
            academicTermId: activeTermId,
            positionTitle: "Committee Liaison",
            grantedSystemRole: "OFFICER",
            isCurrent: true,
            appointedBy: superAdmin.id,
        });

        const publishedEv = await createTestEvent(exec.id, "PUBLISHED");
        const completedEv = await createTestEvent(exec.id, "COMPLETED");

        await signInAs(exec);
        const cpAllRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: publishedEv.id,
                label: "Main Check-In",
                audienceScope: "ALL",
            }),
        );
        const cpAll = (await cpAllRes.json()).data.checkpoint;
        await checkpointPatch(
            makeRequest(`/api/attendance/checkpoints/${cpAll.id}`, "PATCH", { status: "OPEN" }),
            { params: Promise.resolve({ id: cpAll.id }) },
        );

        const cpGenRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: publishedEv.id,
                label: "General Only",
                audienceScope: "GENERAL_MEMBERS",
            }),
        );
        const cpGen = (await cpGenRes.json()).data.checkpoint;
        await checkpointPatch(
            makeRequest(`/api/attendance/checkpoints/${cpGen.id}`, "PATCH", { status: "OPEN" }),
            { params: Promise.resolve({ id: cpGen.id }) },
        );

        // OFFICER lookup verification states
        await signInAs(officer);

        const notFoundRes = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=NO-SUCH-999`,
                "GET",
            ),
        );
        expect((await notFoundRes.json()).data.verificationState).toBe("NOT_FOUND");

        const holdLookupRes = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=${memberHold.studentIdNumber}`,
                "GET",
            ),
        );
        expect((await holdLookupRes.json()).data.verificationState).toBe("ACCOUNT_HOLD");

        // BR-ATT-05: OFFICER scanning another OFFICER, self, or appointment-based officer -> OFFICER_RESTRICTED / 403
        for (const officerTarget of [otherOfficer, officer, appointedMemberRole]) {
            const lRes = await lookupGet(
                makeRequest(
                    `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=${officerTarget.studentIdNumber}`,
                    "GET",
                ),
            );
            expect((await lRes.json()).data.verificationState).toBe("OFFICER_RESTRICTED");

            const cRes = await confirmPost(
                makeRequest("/api/attendance/confirm", "POST", {
                    checkpointId: cpAll.id,
                    studentIdNumber: officerTarget.studentIdNumber,
                }),
            );
            expect(cRes.status).toBe(403);
            expect(await cRes.json()).toMatchObject({ error: { code: "OFFICER_SCAN_RESTRICTED" } });
        }

        // Step 1 + Step 2 for eligible MEMBER (< 1500ms)
        const t0 = performance.now();
        const readyRes = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=${memberReady.studentIdNumber}`,
                "GET",
            ),
        );
        expect(readyRes.status).toBe(200);
        expect((await readyRes.json()).data.verificationState).toBe("READY");

        const confirmRes = await confirmPost(
            makeRequest("/api/attendance/confirm", "POST", {
                checkpointId: cpAll.id,
                studentIdNumber: memberReady.studentIdNumber,
            }),
        );
        const elapsedMs = performance.now() - t0;
        expect(confirmRes.status).toBe(201);
        expect(elapsedMs).toBeLessThan(1500);
        const confirmedRecord = (await confirmRes.json()).data.record;

        // Duplicate scan -> lookup ALREADY_LOGGED & confirm 409 ALREADY_LOGGED
        const dupLookupRes = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=${memberReady.studentIdNumber}`,
                "GET",
            ),
        );
        expect((await dupLookupRes.json()).data.verificationState).toBe("ALREADY_LOGGED");

        const dupConfirmRes = await confirmPost(
            makeRequest("/api/attendance/confirm", "POST", {
                checkpointId: cpAll.id,
                studentIdNumber: memberReady.studentIdNumber,
            }),
        );
        expect(dupConfirmRes.status).toBe(409);
        expect(await dupConfirmRes.json()).toMatchObject({
            error: {
                code: "ALREADY_LOGGED",
                details: { existingRecord: { id: confirmedRecord.id } },
            },
        });

        // Audience mismatch check (EXECUTIVE scanning an OFFICER on GENERAL_MEMBERS checkpoint)
        await signInAs(exec);
        const mismatchLookup = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpGen.id}&studentId=${officer.studentIdNumber}`,
                "GET",
            ),
        );
        expect((await mismatchLookup.json()).data.verificationState).toBe("AUDIENCE_MISMATCH");
        expect(
            (
                await confirmPost(
                    makeRequest("/api/attendance/confirm", "POST", {
                        checkpointId: cpGen.id,
                        studentIdNumber: officer.studentIdNumber,
                    }),
                )
            ).status,
        ).toBe(400);

        // OFFICER cannot override attendance (403)
        await signInAs(officer);
        expect(
            (
                await overridePatch(
                    makeRequest("/api/attendance/override", "PATCH", {
                        recordId: confirmedRecord.id,
                        status: "LATE",
                        editReason: "Unauthorized edit",
                    }),
                )
            ).status,
        ).toBe(403);

        // EXECUTIVE override without valid editReason -> 400; with valid editReason -> 200 + audit log
        await signInAs(exec);
        expect(
            (
                await overridePatch(
                    makeRequest("/api/attendance/override", "PATCH", {
                        recordId: confirmedRecord.id,
                        status: "LATE",
                        editReason: "ok",
                    }),
                )
            ).status,
        ).toBe(400);

        const editReason = "Student arrived 15 minutes after opening bell.";
        const overrideOkRes = await overridePatch(
            makeRequest("/api/attendance/override", "PATCH", {
                recordId: confirmedRecord.id,
                status: "LATE",
                editReason,
            }),
        );
        expect(overrideOkRes.status).toBe(200);
        expect((await overrideOkRes.json()).data.record.status).toBe("LATE");

        const [overrideAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, confirmedRecord.id),
                    eq(auditLogs.action, "ATTENDANCE_OVERRIDDEN"),
                ),
            );
        expect(overrideAudit.beforeState).toMatchObject({ status: "PRESENT" });
        expect(overrideAudit.afterState).toMatchObject({ status: "LATE" });
        expect(overrideAudit.reason).toBe(editReason);

        // Adjustment 4: Duplicate POST /api/attendance/override -> 409 ALREADY_LOGGED with existingRecord
        const dupManualRes = await overridePost(
            makeRequest("/api/attendance/override", "POST", {
                checkpointId: cpAll.id,
                studentIdNumber: memberReady.studentIdNumber,
                status: "EXCUSED",
                editReason: "Duplicate manual check",
            }),
        );
        expect(dupManualRes.status).toBe(409);
        expect(await dupManualRes.json()).toMatchObject({
            error: {
                code: "ALREADY_LOGGED",
                details: { existingRecord: { id: confirmedRecord.id } },
            },
        });

        // Manual POST for officer succeeds for EXECUTIVE -> ATTENDANCE_MANUAL_CREATED
        const manualRes = await overridePost(
            makeRequest("/api/attendance/override", "POST", {
                checkpointId: cpAll.id,
                studentIdNumber: officer.studentIdNumber,
                status: "EXCUSED",
                editReason: "Excused due to concurrent class.",
            }),
        );
        expect(manualRes.status).toBe(201);

        // Close cpAll -> lookup returns 409 CHECKPOINT_NOT_OPEN (Adjustment 2 parity)
        await checkpointPatch(
            makeRequest(`/api/attendance/checkpoints/${cpAll.id}`, "PATCH", { status: "CLOSED" }),
            { params: Promise.resolve({ id: cpAll.id }) },
        );
        const closedLookupRes = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpAll.id}&studentId=${memberReady.studentIdNumber}`,
                "GET",
            ),
        );
        expect(closedLookupRes.status).toBe(409);
        expect(await closedLookupRes.json()).toMatchObject({
            error: { code: "CHECKPOINT_NOT_OPEN" },
        });

        // SUPER_ADMIN break-glass scan on OPEN checkpoint & COMPLETED event lock checks
        await signInAs(superAdmin);
        const saLookup = await lookupGet(
            makeRequest(
                `/api/attendance/lookup?checkpointId=${cpGen.id}&studentId=${memberReady.studentIdNumber}`,
                "GET",
            ),
        );
        expect((await saLookup.json()).data).toMatchObject({
            verificationState: "READY",
            requiresBreakGlass: true,
        });
        expect(
            (
                await confirmPost(
                    makeRequest("/api/attendance/confirm", "POST", {
                        checkpointId: cpGen.id,
                        studentIdNumber: memberReady.studentIdNumber,
                    }),
                )
            ).status,
        ).toBe(400);
        const saConfirmRes = await confirmPost(
            makeRequest("/api/attendance/confirm", "POST", {
                checkpointId: cpGen.id,
                studentIdNumber: memberReady.studentIdNumber,
                breakGlass: true,
                reason: "Super Admin stepping in for unavailable scanner.",
            }),
        );
        expect(saConfirmRes.status).toBe(201);
        const saScanId = (await saConfirmRes.json()).data.record.id;
        const [saScanAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, saScanId),
                    eq(auditLogs.action, "ATTENDANCE_SCAN_BREAK_GLASS"),
                ),
            );
        expect(saScanAudit.afterState).toMatchObject({ break_glass: true });

        const compCpRes = await checkpointsPost(
            makeRequest("/api/attendance/checkpoints", "POST", {
                eventId: completedEv.id,
                label: "Historical CP",
                breakGlass: true,
                reason: "Adding historical checkpoint after completion.",
            }),
        );
        const compCp = (await compCpRes.json()).data.checkpoint;

        // EXECUTIVE blocked from manual override on COMPLETED event (409)
        await signInAs(exec);
        expect(
            (
                await overridePost(
                    makeRequest("/api/attendance/override", "POST", {
                        checkpointId: compCp.id,
                        studentIdNumber: memberReady.studentIdNumber,
                        status: "PRESENT",
                        editReason: "Late correction attempt",
                    }),
                )
            ).status,
        ).toBe(409);

        // SUPER_ADMIN break-glass manual override on COMPLETED event succeeds
        await signInAs(superAdmin);
        const bgManualRes = await overridePost(
            makeRequest("/api/attendance/override", "POST", {
                checkpointId: compCp.id,
                studentIdNumber: memberReady.studentIdNumber,
                status: "PRESENT",
                editReason: "Verified paper sign-in sheet after event close.",
                breakGlass: true,
            }),
        );
        expect(bgManualRes.status).toBe(201);

        // Timestamped record for Asia/Manila filter verification
        await conn.db
            .update(attendanceRecords)
            .set({ recordedAt: new Date("2031-04-10T15:30:00.000Z") }) // 2031-04-10 23:30 PHT
            .where(eq(attendanceRecords.id, confirmedRecord.id));

        const filteredRecRes = await recordsGet(
            makeRequest(
                `/api/attendance/records?eventId=${publishedEv.id}&from=2031-04-10&to=2031-04-10`,
                "GET",
            ),
        );
        expect(filteredRecRes.status).toBe(200);
        const filteredIds = (
            (await filteredRecRes.json()).data.items as Array<{ id: string }>
        ).map((r) => r.id);
        expect(filteredIds).toContain(confirmedRecord.id);

        // Formula-safe, PII-minimized CSV export with headers
        const exportRes = await exportGet(
            makeRequest(`/api/attendance/export?eventId=${publishedEv.id}`, "GET"),
        );
        expect(exportRes.status).toBe(200);
        expect(exportRes.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(exportRes.headers.get("cache-control")).toBe("no-store");
        expect(exportRes.headers.get("x-content-type-options")).toBe("nosniff");
        expect(exportRes.headers.get("content-disposition")).toBe(
            'attachment; filename="sycomp-attendance.csv"',
        );
        expect(exportRes.headers.get("x-export-limit")).toBe("2000");
        expect(exportRes.headers.get("x-export-truncated")).toBe("false");

        const csvText = await exportRes.text();
        expect(csvText).toContain("'=HYPERLINK");
        expect(csvText).not.toContain(secretEmail);
        expect(csvText).not.toContain("passwordHash");
    });
});
