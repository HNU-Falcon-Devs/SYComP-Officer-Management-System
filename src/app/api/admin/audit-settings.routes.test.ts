import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import { auditLogs, documentTypes, userSessions, users } from "@/db/schema";
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

import { GET as auditLogsExportGet } from "./audit-logs/export/route";
import { GET as auditLogsGet } from "./audit-logs/route";
import { PATCH as documentTypePatch } from "./document-types/[id]/route";
import { GET as documentTypesGet, POST as documentTypesPost } from "./document-types/route";
import { GET as settingsGet } from "./settings/route";

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

describe.skipIf(!directUrl)("M4A-prep admin Audit Logs & System Settings routes (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    const createdDocTypeIds: string[] = [];

    beforeAll(() => {
        conn = createDb(directUrl!, { max: 2 });
    });

    beforeEach(() => {
        cookieJar.value = undefined;
    });

    afterAll(async () => {
        if (createdDocTypeIds.length > 0) {
            await conn.db
                .delete(documentTypes)
                .where(inArray(documentTypes.id, createdDocTypeIds));
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
        const studentId = `M4A-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = "Deligero";
        const passwordHash = await hashPassword(normalizeDefaultPassword(lastName, studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "AuditTest",
                lastName,
                fullName: `AuditTest ${studentId}`,
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

    it("enforces RBAC (401/403), ACCOUNT_HOLD, and CSRF across audit-logs, document-types, and settings", async () => {
        const member = await createTestUser("MEMBER");
        const officer = await createTestUser("OFFICER");
        const exec = await createTestUser("EXECUTIVE");
        const superAdmin = await createTestUser("SUPER_ADMIN");
        const disabledExec = await createTestUser("EXECUTIVE", "DISABLED");

        // Unauthenticated -> 401
        expect((await auditLogsGet(makeRequest("/api/admin/audit-logs", "GET"))).status).toBe(401);
        expect(
            (await auditLogsExportGet(makeRequest("/api/admin/audit-logs/export", "GET"))).status,
        ).toBe(401);
        expect(
            (await documentTypesGet(makeRequest("/api/admin/document-types", "GET"))).status,
        ).toBe(401);
        expect((await settingsGet()).status).toBe(401);

        // MEMBER & OFFICER denied across all 5 endpoints (403)
        for (const deniedUser of [member, officer]) {
            await signInAs(deniedUser);
            expect((await auditLogsGet(makeRequest("/api/admin/audit-logs", "GET"))).status).toBe(
                403,
            );
            expect(
                (await auditLogsExportGet(makeRequest("/api/admin/audit-logs/export", "GET")))
                    .status,
            ).toBe(403);
            expect(
                (await documentTypesGet(makeRequest("/api/admin/document-types", "GET"))).status,
            ).toBe(403);
            expect(
                (
                    await documentTypesPost(
                        makeRequest("/api/admin/document-types", "POST", {
                            name: "Denied",
                            driveFolderSegment: "Denied",
                        }),
                    )
                ).status,
            ).toBe(403);
            expect((await settingsGet()).status).toBe(403);
        }

        // DISABLED account -> 403 ACCOUNT_HOLD + revokes session
        const disabledToken = await signInAs(disabledExec);
        const holdRes = await auditLogsGet(makeRequest("/api/admin/audit-logs", "GET"));
        expect(holdRes.status).toBe(403);
        expect(await holdRes.json()).toMatchObject({ error: { code: "ACCOUNT_HOLD" } });
        expect(await getSessionFromToken(conn.db, disabledToken)).toBeNull();

        // EXECUTIVE allowed audit-logs, export, and document-types, but DENIED /api/admin/settings (403)
        await signInAs(exec);
        expect((await auditLogsGet(makeRequest("/api/admin/audit-logs", "GET"))).status).toBe(200);
        expect(
            (await auditLogsExportGet(makeRequest("/api/admin/audit-logs/export", "GET"))).status,
        ).toBe(200);
        expect(
            (await documentTypesGet(makeRequest("/api/admin/document-types", "GET"))).status,
        ).toBe(200);
        expect((await settingsGet()).status).toBe(403);

        // Missing/cross-origin CSRF -> 403 CSRF_FORBIDDEN
        await signInAs(superAdmin);
        const noOriginRes = await documentTypesPost(
            makeRequest(
                "/api/admin/document-types",
                "POST",
                { name: "No Origin", driveFolderSegment: "No Origin" },
                { origin: null },
            ),
        );
        expect(noOriginRes.status).toBe(403);
        expect(await noOriginRes.json()).toMatchObject({ error: { code: "CSRF_FORBIDDEN" } });

        const crossOriginRes = await documentTypesPost(
            makeRequest(
                "/api/admin/document-types",
                "POST",
                { name: "Cross Origin", driveFolderSegment: "Cross Origin" },
                { origin: "https://evil.example" },
            ),
        );
        expect(crossOriginRes.status).toBe(403);

        // SUPER_ADMIN allowed /api/admin/settings with no-store and ZERO leaked secrets
        const settingsRes = await settingsGet();
        expect(settingsRes.status).toBe(200);
        expect(settingsRes.headers.get("cache-control")).toBe("no-store");
        const settingsText = await settingsRes.text();
        for (const sensitiveKey of [
            "DATABASE_URL",
            "DIRECT_DATABASE_URL",
            "OTP_HMAC_SECRET",
            "UPLOAD_INTENT_SECRET",
            "GOOGLE_DRIVE_CLIENT_SECRET",
            "GOOGLE_DRIVE_REFRESH_TOKEN",
            "passwordHash",
        ]) {
            expect(settingsText).not.toContain(sensitiveKey);
        }
        if (process.env.DATABASE_URL) {
            expect(settingsText).not.toContain(process.env.DATABASE_URL);
        }
        if (process.env.OTP_HMAC_SECRET) {
            expect(settingsText).not.toContain(process.env.OTP_HMAC_SECRET);
        }
    });

    it("manages document_types lifecycle with Drive validation, immutable slug, 409 conflicts, and atomic audit logs", async () => {
        const exec = await createTestUser("EXECUTIVE");
        await signInAs(exec);

        const suffix = randomUUID().slice(0, 6).toLowerCase();
        const nameA = `Exec Doc Type ${suffix}`;
        const segmentA = `Exec Folder ${suffix}`;

        // POST creates doc type + DOCUMENT_TYPE_CREATED audit log atomically
        const createRes = await documentTypesPost(
            makeRequest("/api/admin/document-types", "POST", {
                name: nameA,
                driveFolderSegment: segmentA,
            }),
        );
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()).data.documentType;
        createdDocTypeIds.push(created.id);
        expect(created.slug).toBe(`exec-doc-type-${suffix}`);
        expect(created.isActive).toBe(true);

        const [createAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, created.id),
                    eq(auditLogs.action, "DOCUMENT_TYPE_CREATED"),
                ),
            );
        expect(createAudit).toBeDefined();
        expect(createAudit.actorId).toBe(exec.id);
        expect(createAudit.afterState).toMatchObject({
            name: nameA,
            slug: created.slug,
            driveFolderSegment: segmentA,
            isActive: true,
        });

        // Duplicate name or slug -> 409 DOCUMENT_TYPE_CONFLICT
        const dupRes = await documentTypesPost(
            makeRequest("/api/admin/document-types", "POST", {
                name: nameA,
                slug: `other-${suffix}`,
                driveFolderSegment: `Other ${suffix}`,
            }),
        );
        expect(dupRes.status).toBe(409);
        expect(await dupRes.json()).toMatchObject({ error: { code: "DOCUMENT_TYPE_CONFLICT" } });

        // Unsafe Drive folder segments -> 400
        for (const badSegment of ["a|b", "../etc", ".hidden", "trail.", "a\x07b", ".", ".."]) {
            const badRes = await documentTypesPost(
                makeRequest("/api/admin/document-types", "POST", {
                    name: `Bad ${randomUUID().slice(0, 4)}`,
                    driveFolderSegment: badSegment,
                }),
            );
            expect(badRes.status).toBe(400);
        }

        // Create second doc type to test PATCH 409 conflict
        const nameB = `Second Type ${suffix}`;
        const createBRes = await documentTypesPost(
            makeRequest("/api/admin/document-types", "POST", {
                name: nameB,
                slug: `second-type-${suffix}`,
                driveFolderSegment: `Second Folder ${suffix}`,
            }),
        );
        expect(createBRes.status).toBe(201);
        const createdB = (await createBRes.json()).data.documentType;
        createdDocTypeIds.push(createdB.id);

        // PATCH rejects slug mutation (400), unknown UUID (404), invalid UUID (400)
        const slugMutationRes = await documentTypePatch(
            makeRequest(`/api/admin/document-types/${created.id}`, "PATCH", {
                slug: "hacked-slug",
                name: "Renamed",
            }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(slugMutationRes.status).toBe(400);

        const missingId = randomUUID();
        const notFoundRes = await documentTypePatch(
            makeRequest(`/api/admin/document-types/${missingId}`, "PATCH", {
                name: "Missing",
            }),
            { params: Promise.resolve({ id: missingId }) },
        );
        expect(notFoundRes.status).toBe(404);

        const badUuidRes = await documentTypePatch(
            makeRequest("/api/admin/document-types/not-a-uuid", "PATCH", {
                name: "Bad UUID",
            }),
            { params: Promise.resolve({ id: "not-a-uuid" }) },
        );
        expect(badUuidRes.status).toBe(400);

        // PATCH conflicting name -> 409 DOCUMENT_TYPE_CONFLICT
        const conflictPatchRes = await documentTypePatch(
            makeRequest(`/api/admin/document-types/${created.id}`, "PATCH", {
                name: nameB,
            }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(conflictPatchRes.status).toBe(409);
        expect(await conflictPatchRes.json()).toMatchObject({
            error: { code: "DOCUMENT_TYPE_CONFLICT" },
        });

        // PATCH metadata update -> DOCUMENT_TYPE_UPDATED
        const updatedName = `Updated Doc ${suffix}`;
        const updatedSeg = `Updated Folder ${suffix}`;
        const patchMetaRes = await documentTypePatch(
            makeRequest(`/api/admin/document-types/${created.id}`, "PATCH", {
                name: updatedName,
                driveFolderSegment: updatedSeg,
                reason: "Standardizing folder naming.",
            }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(patchMetaRes.status).toBe(200);
        const patchedMeta = (await patchMetaRes.json()).data.documentType;
        expect(patchedMeta.name).toBe(updatedName);
        expect(patchedMeta.driveFolderSegment).toBe(updatedSeg);
        expect(patchedMeta.slug).toBe(created.slug);

        const [metaAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, created.id),
                    eq(auditLogs.action, "DOCUMENT_TYPE_UPDATED"),
                ),
            );
        expect(metaAudit.beforeState).toMatchObject({ name: nameA, driveFolderSegment: segmentA });
        expect(metaAudit.afterState).toMatchObject({
            name: updatedName,
            driveFolderSegment: updatedSeg,
        });
        expect(metaAudit.reason).toBe("Standardizing folder naming.");

        // PATCH soft-disable -> DOCUMENT_TYPE_STATUS_CHANGED
        const disableRes = await documentTypePatch(
            makeRequest(`/api/admin/document-types/${created.id}`, "PATCH", {
                isActive: false,
            }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(disableRes.status).toBe(200);
        expect((await disableRes.json()).data.documentType.isActive).toBe(false);

        const [statusAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityId, created.id),
                    eq(auditLogs.action, "DOCUMENT_TYPE_STATUS_CHANGED"),
                ),
            );
        expect(statusAudit.beforeState).toMatchObject({ isActive: true });
        expect(statusAudit.afterState).toMatchObject({ isActive: false });

        // GET ?includeInactive=false hides soft-disabled type
        const activeOnlyRes = await documentTypesGet(
            makeRequest("/api/admin/document-types?includeInactive=false", "GET"),
        );
        expect(activeOnlyRes.status).toBe(200);
        const activeIds = new Set(
            ((await activeOnlyRes.json()).data.documentTypes as Array<{ id: string }>).map(
                (d) => d.id,
            ),
        );
        expect(activeIds.has(created.id)).toBe(false);
        expect(activeIds.has(createdB.id)).toBe(true);
    });

    it("queries audit_logs with LEFT JOIN, Manila date bounds, break-glass filter, redaction, and safe CSV export", async () => {
        const superAdmin = await createTestUser("SUPER_ADMIN");
        await signInAs(superAdmin);

        const tag = randomUUID().slice(0, 8).toUpperCase();
        const sysEntityId = randomUUID();
        const bgEntityId = randomUUID();
        const manilaSameDayEntityId = randomUUID();
        const manilaNextDayEntityId = randomUUID();

        // 1) System-actor (actorId: null) row with leaked sensitive keys & formula reason
        await conn.db.insert(auditLogs).values({
            actorId: null,
            action: `SYS_ROUTINE_${tag}`,
            entityType: "system_job",
            entityId: sysEntityId,
            beforeState: { password_hash: "leaked-before", status: "PENDING" },
            afterState: { tokenHash: "leaked-after", status: "DONE" },
            reason: `=HYPERLINK("http://evil","${tag}")`,
            createdAt: new Date("2031-03-15T04:00:00.000Z"), // 2031-03-15 12:00:00 PHT
        });

        // 2) Break-glass row matching M2A closed-term shape
        await conn.db.insert(auditLogs).values({
            actorId: superAdmin.id,
            action: `BG_OVERRIDE_${tag}`,
            entityType: "officer_appointment",
            entityId: bgEntityId,
            beforeState: { isCurrent: true },
            afterState: { isCurrent: false, break_glass: true },
            reason: `Break-glass audit test ${tag}`,
            createdAt: new Date("2031-03-15T15:30:00.000Z"), // 2031-03-15 23:30:00 PHT (same Manila day)
        });

        // 3) Row on 2031-03-16 00:05:00 PHT (should be EXCLUDED from to=2031-03-15)
        await conn.db.insert(auditLogs).values({
            actorId: superAdmin.id,
            action: `NEXT_DAY_${tag}`,
            entityType: "officer_appointment",
            entityId: manilaNextDayEntityId,
            afterState: { note: tag },
            createdAt: new Date("2031-03-15T16:05:00.000Z"), // 2031-03-16 00:05:00 PHT
        });

        // 4) Extra row on 2031-03-15 PHT for pagination check
        await conn.db.insert(auditLogs).values({
            actorId: superAdmin.id,
            action: `SAME_DAY_${tag}`,
            entityType: "system_job",
            entityId: manilaSameDayEntityId,
            afterState: { note: tag },
            createdAt: new Date("2031-03-15T10:00:00.000Z"), // 2031-03-15 18:00:00 PHT
        });

        // Reversed date range -> 400
        const badRangeRes = await auditLogsGet(
            makeRequest("/api/admin/audit-logs?from=2031-03-16&to=2031-03-15", "GET"),
        );
        expect(badRangeRes.status).toBe(400);

        // Single-day Asia/Manila filter includes 23:30 PHT and excludes 00:05 PHT next day, and keeps actorId=null row
        const dayRes = await auditLogsGet(
            makeRequest(
                `/api/admin/audit-logs?q=${tag}&from=2031-03-15&to=2031-03-15`,
                "GET",
            ),
        );
        expect(dayRes.status).toBe(200);
        expect(dayRes.headers.get("cache-control")).toBe("no-store");
        const dayPayload = await dayRes.json();
        const returnedEntityIds = (dayPayload.data.items as Array<{ entityId: string }>).map(
            (i) => i.entityId,
        );
        expect(returnedEntityIds).toContain(sysEntityId);
        expect(returnedEntityIds).toContain(bgEntityId);
        expect(returnedEntityIds).toContain(manilaSameDayEntityId);
        expect(returnedEntityIds).not.toContain(manilaNextDayEntityId);

        // Defense-in-depth redaction & null actor verified in JSON
        const dayText = JSON.stringify(dayPayload);
        expect(dayText).not.toContain("password_hash");
        expect(dayText).not.toContain("leaked-before");
        expect(dayText).not.toContain("tokenHash");
        expect(dayText).not.toContain("leaked-after");
        const sysItem = dayPayload.data.items.find(
            (i: { entityId: string }) => i.entityId === sysEntityId,
        );
        expect(sysItem.actor).toBeNull();

        // breakGlassOnly=true matches exact JSONB shape
        const bgRes = await auditLogsGet(
            makeRequest(`/api/admin/audit-logs?q=${tag}&breakGlassOnly=true`, "GET"),
        );
        expect(bgRes.status).toBe(200);
        const bgItems = (await bgRes.json()).data.items as Array<{
            entityId: string;
            isBreakGlass: boolean;
        }>;
        expect(bgItems).toHaveLength(1);
        expect(bgItems[0].entityId).toBe(bgEntityId);
        expect(bgItems[0].isBreakGlass).toBe(true);

        // Filter by entityId & actorId
        const actorRes = await auditLogsGet(
            makeRequest(
                `/api/admin/audit-logs?actorId=${superAdmin.id}&entityId=${bgEntityId}`,
                "GET",
            ),
        );
        expect(actorRes.status).toBe(200);
        expect((await actorRes.json()).data.items).toHaveLength(1);

        // CSV Export headers, redaction, and formula neutralization
        const exportRes = await auditLogsExportGet(
            makeRequest(`/api/admin/audit-logs/export?q=${tag}`, "GET"),
        );
        expect(exportRes.status).toBe(200);
        expect(exportRes.headers.get("content-type")).toBe("text/csv; charset=utf-8");
        expect(exportRes.headers.get("cache-control")).toBe("no-store");
        expect(exportRes.headers.get("x-content-type-options")).toBe("nosniff");
        expect(exportRes.headers.get("content-disposition")).toBe(
            'attachment; filename="sycomp-audit-logs.csv"',
        );
        expect(exportRes.headers.get("x-export-limit")).toBe("2000");
        expect(exportRes.headers.get("x-export-truncated")).toBe("false");

        const csvText = await exportRes.text();
        expect(csvText).toContain("'=HYPERLINK");
        expect(csvText).toContain("SYSTEM,System");
        expect(csvText).not.toContain("password_hash");
        expect(csvText).not.toContain("leaked-before");
        expect(csvText).not.toContain("tokenHash");
        expect(csvText).not.toContain("leaked-after");
    });
});
