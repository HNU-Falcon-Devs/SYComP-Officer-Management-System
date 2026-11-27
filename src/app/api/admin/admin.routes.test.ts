import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    academicTerms,
    auditLogs,
    masterlistImports,
    officerAppointments,
    userSessions,
    users,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, getSessionFromToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { recomputeUserSystemRole } from "@/lib/admin/role-sync";

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

import { GET as directoryExportGet } from "./directory/export/route";
import { GET as directoryGet } from "./directory/route";
import { GET as reportGet } from "./masterlist/[id]/report/route";
import { POST as commitPost } from "./masterlist/commit/route";
import { POST as previewPost } from "./masterlist/preview/route";
import { GET as masterlistGet } from "./masterlist/route";
import { POST as activateTermPost } from "./terms/[id]/activate/route";
import { PATCH as endAppointmentPatch } from "./terms/[id]/appointments/[appointmentId]/route";
import {
    GET as appointmentsGet,
    POST as appointmentsPost,
} from "./terms/[id]/appointments/route";
import { GET as termsGet, POST as termsPost } from "./terms/route";
import { POST as resetPasswordPost } from "./users/[id]/reset-password/route";
import { PATCH as updateStatusPost } from "./users/[id]/status/route";

const directUrl = process.env.DIRECT_DATABASE_URL;

function makeRequest(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
    options?: { origin?: string | null },
) {
    const headers = new Headers();
    if (body !== undefined && !(body instanceof FormData)) {
        headers.set("content-type", "application/json");
    }
    if (options?.origin !== null && method !== "GET") {
        headers.set("origin", options?.origin ?? "http://localhost:3000");
    }
    return new Request(`http://localhost:3000${path}`, {
        method,
        headers,
        body:
            body === undefined
                ? undefined
                : body instanceof FormData
                  ? body
                  : JSON.stringify(body),
    });
}

describe.skipIf(!directUrl)("M2A admin Terms, Masterlist, and Directory routes (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    const createdImportIds: string[] = [];
    let originalActiveTermId: string | null = null;
    const createdTermIds: string[] = [];

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });
        const [active] = await conn.db
            .select({ id: academicTerms.id })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);
        originalActiveTermId = active?.id ?? null;
    });

    beforeEach(() => {
        cookieJar.value = undefined;
    });

    afterAll(async () => {
        // Restore seeded active term & appointments if rollover test closed it
        if (originalActiveTermId) {
            await conn.db
                .update(academicTerms)
                .set({ status: "CLOSED", closedAt: new Date() })
                .where(eq(academicTerms.status, "ACTIVE"));
            await conn.db
                .update(academicTerms)
                .set({ status: "ACTIVE", closedAt: null })
                .where(eq(academicTerms.id, originalActiveTermId));

            const restoredAppts = await conn.db
                .update(officerAppointments)
                .set({ isCurrent: true, endedAt: null })
                .where(
                    and(
                        eq(officerAppointments.academicTermId, originalActiveTermId),
                        createdUserIds.length > 0
                            ? notInArray(officerAppointments.userId, createdUserIds)
                            : undefined,
                    ),
                )
                .returning({ userId: officerAppointments.userId });

            for (const uid of new Set(restoredAppts.map((a) => a.userId))) {
                await recomputeUserSystemRole(conn.db, uid, originalActiveTermId);
            }
        }

        if (createdImportIds.length > 0) {
            await conn.db
                .delete(masterlistImports)
                .where(inArray(masterlistImports.id, createdImportIds));
        }
        if (createdUserIds.length > 0) {
            await conn.db
                .delete(userSessions)
                .where(inArray(userSessions.userId, createdUserIds));
        }
        await conn.client.end();
    });

    async function createTestUser(role: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER", status: "ACTIVE" | "DISABLED" | "NEEDS_REVIEW" = "ACTIVE") {
        const studentId = `M2A-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = "Santos";
        const passwordHash = await hashPassword(normalizeDefaultPassword(lastName, studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "AdminTest",
                lastName,
                fullName: `AdminTest ${studentId}`,
                passwordHash,
                mustChangePassword: true,
                systemRole: role,
                accountStatus: status,
                disabledAt: status === "DISABLED" ? new Date() : null,
            })
            .returning();
        createdUserIds.push(user.id);
        return user;
    }

    async function signInAs(user: { id: string; systemRole: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER" }) {
        const sess = await createSession(conn.db, {
            userId: user.id,
            roleTierSnapshot: user.systemRole,
        });
        cookieJar.value = sess.token;
        return sess.token;
    }

    it("enforces RBAC (403) and CSRF (403) across M2A endpoints", async () => {
        const member = await createTestUser("MEMBER");
        const officer = await createTestUser("OFFICER");
        const exec = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");

        // Unauthenticated -> 401
        const unauthTerms = await termsGet();
        expect(unauthTerms.status).toBe(401);

        // Missing/cross-origin CSRF -> 403
        await signInAs(superAdmin);
        const missingOrigin = await termsPost(
            makeRequest("/api/admin/terms", "POST", { code: "X", name: "X" }, { origin: null }),
        );
        expect(missingOrigin.status).toBe(403);
        expect(await missingOrigin.json()).toMatchObject({ error: { code: "CSRF_FORBIDDEN" } });

        // MEMBER denied directory, terms, masterlist
        await signInAs(member);
        expect((await directoryGet(makeRequest("/api/admin/directory", "GET"))).status).toBe(403);
        expect((await termsGet()).status).toBe(403);
        expect((await masterlistGet()).status).toBe(403);

        // OFFICER allowed directory/terms read, denied masterlist & term mutations
        await signInAs(officer);
        expect((await directoryGet(makeRequest("/api/admin/directory", "GET"))).status).toBe(200);
        expect((await termsGet()).status).toBe(200);
        expect((await masterlistGet()).status).toBe(403);
        expect(
            (
                await termsPost(
                    makeRequest("/api/admin/terms", "POST", {
                        code: "T-DENY",
                        name: "Denied",
                        startDate: "2027-01-01",
                        endDate: "2027-05-01",
                    }),
                )
            ).status,
        ).toBe(403);

        // EXECUTIVE allowed read-only masterlist history, denied preview/commit & term mutations
        await signInAs(exec);
        expect((await masterlistGet()).status).toBe(200);
        expect(
            (await previewPost(makeRequest("/api/admin/masterlist/preview", "POST", new FormData())))
                .status,
        ).toBe(403);
    });

    it("performs atomic term rollover, preserves re-appointed officers, downgrades/revokes non-reappointed, and enforces closed-term break-glass", async () => {
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const outgoingDrop = await createTestUser("MEMBER");
        const reappointed = await createTestUser("MEMBER");
        const preStaged = await createTestUser("MEMBER");

        await signInAs(superAdmin);

        // Create outgoing term A and activate it
        const codeA = `TA-${randomUUID().slice(0, 6).toUpperCase()}`;
        const createARes = await termsPost(
            makeRequest("/api/admin/terms", "POST", {
                code: codeA,
                name: `Term ${codeA}`,
                startDate: "2028-01-01",
                endDate: "2028-05-01",
            }),
        );
        expect(createARes.status).toBe(201);
        const termA = (await createARes.json()).data.term;
        createdTermIds.push(termA.id);

        const actARes = await activateTermPost(
            makeRequest(`/api/admin/terms/${termA.id}/activate`, "POST", {}),
            { params: Promise.resolve({ id: termA.id }) },
        );
        expect(actARes.status).toBe(200);

        // Appoint outgoingDrop and reappointed on active term A
        for (const [u, title, role] of [
            [outgoingDrop, "Secretary", "OFFICER"],
            [reappointed, "VP Internal", "EXECUTIVE"],
        ] as const) {
            const apptRes = await appointmentsPost(
                makeRequest(`/api/admin/terms/${termA.id}/appointments`, "POST", {
                    userId: u.id,
                    positionTitle: title,
                    grantedSystemRole: role,
                }),
                { params: Promise.resolve({ id: termA.id }) },
            );
            expect(apptRes.status).toBe(201);
        }

        const dropSession = await createSession(conn.db, {
            userId: outgoingDrop.id,
            roleTierSnapshot: "OFFICER",
        });
        const keepSession = await createSession(conn.db, {
            userId: reappointed.id,
            roleTierSnapshot: "EXECUTIVE",
        });

        // Create DRAFT term B and pre-stage reappointed + preStaged BEFORE activation
        const codeB = `TB-${randomUUID().slice(0, 6).toUpperCase()}`;
        const createBRes = await termsPost(
            makeRequest("/api/admin/terms", "POST", {
                code: codeB,
                name: `Term ${codeB}`,
                startDate: "2028-06-01",
                endDate: "2028-10-01",
            }),
        );
        expect(createBRes.status).toBe(201);
        const termB = (await createBRes.json()).data.term;
        createdTermIds.push(termB.id);

        await appointmentsPost(
            makeRequest(`/api/admin/terms/${termB.id}/appointments`, "POST", {
                userId: reappointed.id,
                positionTitle: "President",
                grantedSystemRole: "EXECUTIVE",
            }),
            { params: Promise.resolve({ id: termB.id }) },
        );
        await appointmentsPost(
            makeRequest(`/api/admin/terms/${termB.id}/appointments`, "POST", {
                userId: preStaged.id,
                positionTitle: "Auditor",
                grantedSystemRole: "OFFICER",
            }),
            { params: Promise.resolve({ id: termB.id }) },
        );

        // Activate term B (rollover)
        const actBRes = await activateTermPost(
            makeRequest(`/api/admin/terms/${termB.id}/activate`, "POST", {}),
            { params: Promise.resolve({ id: termB.id }) },
        );
        expect(actBRes.status).toBe(200);

        // Verify roles & sessions
        const [dropRow] = await conn.db.select().from(users).where(eq(users.id, outgoingDrop.id));
        const [keepRow] = await conn.db.select().from(users).where(eq(users.id, reappointed.id));
        const [preRow] = await conn.db.select().from(users).where(eq(users.id, preStaged.id));

        expect(dropRow.systemRole).toBe("MEMBER");
        expect(await getSessionFromToken(conn.db, dropSession.token)).toBeNull();
        expect(keepRow.systemRole).toBe("EXECUTIVE");
        expect(await getSessionFromToken(conn.db, keepSession.token)).not.toBeNull();
        expect(preRow.systemRole).toBe("OFFICER");

        // Closed term A blocks appointment mutation without break-glass (409)
        const lockedAppt = await appointmentsPost(
            makeRequest(`/api/admin/terms/${termA.id}/appointments`, "POST", {
                userId: preStaged.id,
                positionTitle: "Late Fix",
                grantedSystemRole: "OFFICER",
            }),
            { params: Promise.resolve({ id: termA.id }) },
        );
        expect(lockedAppt.status).toBe(409);
        expect(await lockedAppt.json()).toMatchObject({ error: { code: "RESOURCE_LOCKED" } });

        // Closed term A rejects break-glass POST when reason < 10 chars (400)
        const shortBgAppt = await appointmentsPost(
            makeRequest(`/api/admin/terms/${termA.id}/appointments`, "POST", {
                userId: preStaged.id,
                positionTitle: "Too Short",
                grantedSystemRole: "OFFICER",
                breakGlass: true,
                reason: "short",
            }),
            { params: Promise.resolve({ id: termA.id }) },
        );
        expect(shortBgAppt.status).toBe(400);
        expect(await shortBgAppt.json()).toMatchObject({
            error: { code: "BREAK_GLASS_REASON_REQUIRED" },
        });

        // Closed term A allows break-glass with >= 10 char reason and flags audit log
        const bgPostReason = "Recording missed appointment from previous semester.";
        const bgAppt = await appointmentsPost(
            makeRequest(`/api/admin/terms/${termA.id}/appointments`, "POST", {
                userId: preStaged.id,
                positionTitle: "Historical Correction",
                grantedSystemRole: "OFFICER",
                breakGlass: true,
                reason: bgPostReason,
            }),
            { params: Promise.resolve({ id: termA.id }) },
        );
        expect(bgAppt.status).toBe(201);
        const bgId = (await bgAppt.json()).data.appointment.id;

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.entityId, bgId), eq(auditLogs.action, "OFFICER_APPOINTED")));
        expect(bgAudit.reason).toBe(bgPostReason);
        expect(bgAudit.afterState).toMatchObject({ break_glass: true });

        // Closed term A also enforces break-glass on PATCH appointment end
        await conn.db
            .update(officerAppointments)
            .set({ isCurrent: true, endedAt: null })
            .where(eq(officerAppointments.id, bgId));

        const lockedEndPatch = await endAppointmentPatch(
            makeRequest(`/api/admin/terms/${termA.id}/appointments/${bgId}`, "PATCH", {
                action: "END",
            }),
            { params: Promise.resolve({ id: termA.id, appointmentId: bgId }) },
        );
        expect(lockedEndPatch.status).toBe(409);
        expect(await lockedEndPatch.json()).toMatchObject({ error: { code: "RESOURCE_LOCKED" } });

        const shortEndPatch = await endAppointmentPatch(
            makeRequest(`/api/admin/terms/${termA.id}/appointments/${bgId}`, "PATCH", {
                action: "END",
                breakGlass: true,
                reason: "too short",
            }),
            { params: Promise.resolve({ id: termA.id, appointmentId: bgId }) },
        );
        expect(shortEndPatch.status).toBe(400);
        expect(await shortEndPatch.json()).toMatchObject({
            error: { code: "BREAK_GLASS_REASON_REQUIRED" },
        });

        const bgEndReason = "Closing missed historical appointment record.";
        const bgEndPatch = await endAppointmentPatch(
            makeRequest(`/api/admin/terms/${termA.id}/appointments/${bgId}`, "PATCH", {
                action: "END",
                breakGlass: true,
                reason: bgEndReason,
            }),
            { params: Promise.resolve({ id: termA.id, appointmentId: bgId }) },
        );
        expect(bgEndPatch.status).toBe(200);

        const [bgEndAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.entityId, bgId), eq(auditLogs.action, "OFFICER_ENDED")));
        expect(bgEndAudit.reason).toBe(bgEndReason);
        expect(bgEndAudit.afterState).toMatchObject({ break_glass: true });

        // End appointment on term B (active) -> downgrades preStaged and returns empty committees list
        const termBAppts = await appointmentsGet(
            makeRequest(`/api/admin/terms/${termB.id}/appointments`, "GET"),
            { params: Promise.resolve({ id: termB.id }) },
        );
        const apptsList = (await termBAppts.json()).data.appointments as Array<{
            id: string;
            userId: string;
        }>;
        const preAppt = apptsList.find((a) => a.userId === preStaged.id)!;

        const endRes = await endAppointmentPatch(
            makeRequest(`/api/admin/terms/${termB.id}/appointments/${preAppt.id}`, "PATCH", {
                action: "END",
            }),
            { params: Promise.resolve({ id: termB.id, appointmentId: preAppt.id }) },
        );
        expect(endRes.status).toBe(200);
        const [afterEndRow] = await conn.db.select().from(users).where(eq(users.id, preStaged.id));
        expect(afterEndRow.systemRole).toBe("MEMBER");
    });

    it("imports 100 masterlist students (AC-01), skips re-imports with 0 dupes, flags non-ACTIVE warnings, and exports safe CSV", async () => {
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const existingDisabled = await createTestUser("MEMBER", "DISABLED");
        const existingNeedsReview = await createTestUser("MEMBER", "NEEDS_REVIEW");
        await signInAs(superAdmin);

        const prefix = randomUUID().slice(0, 4).toUpperCase();
        const csvLines = ["student_id_number,first_name,last_name"];
        for (let i = 1; i <= 100; i++) {
            csvLines.push(`M100-${prefix}-${String(i).padStart(3, "0")},Student${i},Dela Cruz`);
        }
        csvLines.push(`${existingDisabled.studentIdNumber},Former,Student`);
        csvLines.push(`${existingNeedsReview.studentIdNumber},Review,Student`);

        const file = new File([csvLines.join("\n")], "ac01.csv", { type: "text/csv" });
        const formData = new FormData();
        formData.append("file", file);

        const prevRes = await previewPost(
            makeRequest("/api/admin/masterlist/preview", "POST", formData),
        );
        expect(prevRes.status).toBe(200);
        const prevBody = await prevRes.json();
        expect(prevBody.data.preview.toCreate).toHaveLength(100);

        const warnings = prevBody.data.preview.warnings as Array<{
            studentIdNumber: string;
            code: string;
        }>;
        const toCreateIds = new Set(
            (prevBody.data.preview.toCreate as Array<{ studentIdNumber: string }>).map(
                (r) => r.studentIdNumber,
            ),
        );
        const existingActiveIds = new Set(
            (prevBody.data.preview.existingActive as Array<{ studentIdNumber: string }>).map(
                (r) => r.studentIdNumber,
            ),
        );

        for (const nonActiveUser of [existingDisabled, existingNeedsReview]) {
            expect(
                warnings.some(
                    (w) =>
                        w.studentIdNumber === nonActiveUser.studentIdNumber &&
                        w.code === "EXISTING_NON_ACTIVE",
                ),
            ).toBe(true);
            expect(toCreateIds.has(nonActiveUser.studentIdNumber)).toBe(false);
            expect(existingActiveIds.has(nonActiveUser.studentIdNumber)).toBe(false);
        }

        const commitRes = await commitPost(
            makeRequest("/api/admin/masterlist/commit", "POST", {
                sourceFilename: "ac01.csv",
                rows: prevBody.data.parsedRows,
                flagMissingAsNeedsReview: false,
            }),
        );
        expect(commitRes.status).toBe(201);
        const commitBody = await commitRes.json();
        createdImportIds.push(commitBody.data.importRecord.id);
        expect(commitBody.data.importRecord.createdCount).toBe(100);

        // Verify first seeded member can verify normalized default password
        const sampleId = `M100-${prefix}-001`;
        const [sampleUser] = await conn.db
            .select()
            .from(users)
            .where(eq(users.studentIdNumber, sampleId));
        createdUserIds.push(sampleUser.id);
        await expect(
            verifyPassword(
                normalizeDefaultPassword("Dela Cruz", sampleId),
                sampleUser.passwordHash,
            ),
        ).resolves.toBe(true);

        // Re-import creates 0 duplicates
        const recommitRes = await commitPost(
            makeRequest("/api/admin/masterlist/commit", "POST", {
                sourceFilename: "ac01-reimport.csv",
                rows: prevBody.data.parsedRows,
                flagMissingAsNeedsReview: false,
            }),
        );
        expect(recommitRes.status).toBe(201);
        const recommitBody = await recommitRes.json();
        createdImportIds.push(recommitBody.data.importRecord.id);
        expect(recommitBody.data.importRecord.createdCount).toBe(0);
        expect(recommitBody.data.importRecord.skippedExistingCount).toBe(100);

        // Report CSV export headers
        const reportRes = await reportGet(
            makeRequest(`/api/admin/masterlist/${commitBody.data.importRecord.id}/report`, "GET"),
            { params: Promise.resolve({ id: commitBody.data.importRecord.id }) },
        );
        expect(reportRes.status).toBe(200);
        expect(reportRes.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(reportRes.headers.get("cache-control")).toBe("no-store");
        expect(reportRes.headers.get("x-content-type-options")).toBe("nosniff");
        expect(reportRes.headers.get("content-disposition")).toContain("attachment;");
        expect(await reportRes.text()).toContain(existingDisabled.studentIdNumber);

        // Track remaining created users for session cleanup
        const createdBatch = await conn.db
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.studentIdNumber, prevBody.data.preview.toCreate.map((r: { studentIdNumber: string }) => r.studentIdNumber)));
        for (const u of createdBatch) {
            createdUserIds.push(u.id);
        }
    });

    it("enforces soft-disable revocation (AC-08), last-SUPER_ADMIN guard (409), admin reset, and safe directory export", async () => {
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const officer = await createTestUser("OFFICER");
        const officerSession = await createSession(conn.db, {
            userId: officer.id,
            roleTierSnapshot: "OFFICER",
        });

        await signInAs(superAdmin);

        // Disable officer -> revokes session immediately & preserves record
        const disableRes = await updateStatusPost(
            makeRequest(`/api/admin/users/${officer.id}/status`, "PATCH", {
                accountStatus: "DISABLED",
                reason: "Graduated BSCS 2026",
            }),
            { params: Promise.resolve({ id: officer.id }) },
        );
        expect(disableRes.status).toBe(200);
        expect(await getSessionFromToken(conn.db, officerSession.token)).toBeNull();

        // Admin password reset sets mustChangePassword = true & audits without hash
        const resetRes = await resetPasswordPost(
            makeRequest(`/api/admin/users/${officer.id}/reset-password`, "POST", {
                reason: "In-person identity verified at SYComP office.",
            }),
            { params: Promise.resolve({ id: officer.id }) },
        );
        expect(resetRes.status).toBe(200);
        expect((await resetRes.json()).data.user.mustChangePassword).toBe(true);

        // Directory search & export headers
        const dirRes = await directoryGet(
            makeRequest(`/api/admin/directory?q=${officer.studentIdNumber}`, "GET"),
        );
        expect(dirRes.status).toBe(200);
        const dirText = await dirRes.text();
        expect(dirText).not.toContain("passwordHash");
        expect(dirText).toContain(officer.studentIdNumber);

        const expRes = await directoryExportGet(
            makeRequest(`/api/admin/directory/export?q=${officer.studentIdNumber}`, "GET"),
        );
        expect(expRes.status).toBe(200);
        expect(expRes.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(expRes.headers.get("cache-control")).toBe("no-store");
        expect(expRes.headers.get("x-content-type-options")).toBe("nosniff");
        expect(expRes.headers.get("content-disposition")).toContain("attachment;");

        // Formula neutralization in directory CSV export
        const formulaId = `M2A-${randomUUID().slice(0, 8).toUpperCase()}`;
        const formulaHash = await hashPassword(normalizeDefaultPassword("Formula", formulaId));
        const [formulaUser] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: formulaId,
                firstName: "Evil",
                lastName: "Formula",
                fullName: '=HYPERLINK("http://evil")',
                passwordHash: formulaHash,
                mustChangePassword: true,
                systemRole: "MEMBER",
                accountStatus: "ACTIVE",
            })
            .returning();
        createdUserIds.push(formulaUser.id);

        const formulaExpRes = await directoryExportGet(
            makeRequest(`/api/admin/directory/export?q=${formulaUser.studentIdNumber}`, "GET"),
        );
        expect(formulaExpRes.status).toBe(200);
        const formulaExpText = await formulaExpRes.text();
        expect(formulaExpText).toContain("'=HYPERLINK");
        expect(formulaExpText).not.toContain("passwordHash");

        // Last SUPER_ADMIN guard: disable all other active SUPER_ADMINs temporarily inside check?
        // Only assert if exactly 1 active SUPER_ADMIN exists; otherwise create & verify count check is deterministic:
        const activeAdmins = await conn.db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.systemRole, "SUPER_ADMIN"), eq(users.accountStatus, "ACTIVE")));
        for (const extra of activeAdmins) {
            if (extra.id !== superAdmin.id) {
                await conn.db
                    .update(users)
                    .set({ accountStatus: "DISABLED", disabledAt: new Date() })
                    .where(eq(users.id, extra.id));
            }
        }

        try {
            for (const targetStatus of ["DISABLED", "NEEDS_REVIEW"] as const) {
                const blocked = await updateStatusPost(
                    makeRequest(`/api/admin/users/${superAdmin.id}/status`, "PATCH", {
                        accountStatus: targetStatus,
                        reason: "Attempting to disable last super admin.",
                    }),
                    { params: Promise.resolve({ id: superAdmin.id }) },
                );
                expect(blocked.status).toBe(409);
                expect(await blocked.json()).toMatchObject({
                    error: { code: "LAST_SUPER_ADMIN" },
                });
            }
        } finally {
            for (const extra of activeAdmins) {
                if (extra.id !== superAdmin.id) {
                    await conn.db
                        .update(users)
                        .set({ accountStatus: "ACTIVE", disabledAt: null })
                        .where(eq(users.id, extra.id));
                }
            }
        }
    });
});
