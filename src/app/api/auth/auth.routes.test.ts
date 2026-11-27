import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    auditLogs,
    rateLimitBuckets,
    userSessions,
    users,
    verificationTokens,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { createSession, getSessionFromToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { ConsoleEmailProvider } from "@/lib/email/console.provider";

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

import { POST as requestOtpPost } from "./email/request-otp/route";
import { POST as verifyOtpPost } from "./email/verify-otp/route";
import { POST as loginPost } from "./login/route";
import { POST as logoutPost } from "./logout/route";
import { POST as changePasswordPost } from "./password/change/route";
import { POST as resetConfirmPost } from "./password/reset-confirm/route";
import { POST as resetRequestPost } from "./password/reset-request/route";

const directUrl = process.env.DIRECT_DATABASE_URL;

function extractSessionCookie(setCookieHeader: string | null): string | undefined {
    if (!setCookieHeader) return undefined;
    const match = setCookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    return match?.[1];
}

function makePostRequest(
    path: string,
    body: unknown,
    options?: { origin?: string | null; referer?: string | null; ip?: string },
) {
    const headers = new Headers({ "content-type": "application/json" });
    if (options?.origin !== null) {
        headers.set("origin", options?.origin ?? "http://localhost:3000");
    }
    if (options?.referer) {
        headers.set("referer", options.referer);
    }
    if (options?.ip) {
        headers.set("x-forwarded-for", options.ip);
    }
    return new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

describe.skipIf(!directUrl)("M2 auth route handlers integration (local Supabase)", () => {
    let conn: DbConnection;
    const createdUserIds: string[] = [];
    const createdRateKeys: string[] = [];

    beforeAll(() => {
        conn = createDb(directUrl!, { max: 2 });
    });

    beforeEach(() => {
        cookieJar.value = undefined;
    });

    afterAll(async () => {
        if (createdUserIds.length > 0) {
            await conn.db
                .delete(verificationTokens)
                .where(inArray(verificationTokens.userId, createdUserIds));
            await conn.db
                .delete(userSessions)
                .where(inArray(userSessions.userId, createdUserIds));
        }
        if (createdRateKeys.length > 0) {
            await conn.db
                .delete(rateLimitBuckets)
                .where(inArray(rateLimitBuckets.key, createdRateKeys));
        }
        await conn.client.end();
    });

    async function seedTestUser(overrides?: {
        systemRole?: "MEMBER" | "OFFICER" | "EXECUTIVE" | "SUPER_ADMIN";
        accountStatus?: "ACTIVE" | "DISABLED" | "NEEDS_REVIEW";
        lastName?: string;
        universityEmail?: string | null;
        emailVerifiedAt?: Date | null;
    }) {
        const studentId = `M2T-${randomUUID().slice(0, 8).toUpperCase()}`;
        const lastName = overrides?.lastName ?? "Reyes";
        const defaultPw = normalizeDefaultPassword(lastName, studentId);
        const passwordHash = await hashPassword(defaultPw);

        const [created] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "Test",
                lastName,
                fullName: `Test ${lastName}`,
                passwordHash,
                mustChangePassword: true,
                systemRole: overrides?.systemRole ?? "MEMBER",
                accountStatus: overrides?.accountStatus ?? "ACTIVE",
                disabledAt: overrides?.accountStatus === "DISABLED" ? new Date() : null,
                universityEmail: overrides?.universityEmail ?? null,
                emailVerifiedAt: overrides?.emailVerifiedAt ?? null,
            })
            .returning();

        createdUserIds.push(created.id);
        return { user: created, defaultPw };
    }

    it("rejects cross-origin and missing-origin POST requests with 403 CSRF_FORBIDDEN", async () => {
        const crossOrigin = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: "ANY", password: "any" },
                { origin: "https://evil.example.com" },
            ),
        );
        expect(crossOrigin.status).toBe(403);
        expect(await crossOrigin.json()).toMatchObject({
            error: { code: "CSRF_FORBIDDEN" },
        });

        const missingOrigin = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: "ANY", password: "any" },
                { origin: null },
            ),
        );
        expect(missingOrigin.status).toBe(403);
        expect(await missingOrigin.json()).toMatchObject({
            error: { code: "CSRF_FORBIDDEN" },
        });
    });

    it("authenticates MEMBER/EXECUTIVE, emits HttpOnly cookie without secrets, and logs out cleanly", async () => {
        const ip = `10.20.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
        createdRateKeys.push(`login:ip:${ip}`);

        const member = await seedTestUser({ systemRole: "MEMBER" });
        const loginRes = await loginPost(
            makePostRequest(
                "/api/auth/login",
                {
                    studentIdNumber: member.user.studentIdNumber,
                    password: member.defaultPw,
                    next: "/dashboard", // MEMBER must still land on /portal
                },
                { ip },
            ),
        );

        expect(loginRes.status).toBe(200);
        const body = await loginRes.json();
        expect(body.data.redirectTo).toBe("/portal");
        expect(JSON.stringify(body)).not.toContain("passwordHash");

        const setCookie = loginRes.headers.get("set-cookie");
        expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie?.toLowerCase()).toContain("samesite=lax");

        const token = extractSessionCookie(setCookie);
        expect(token).toBeTruthy();
        cookieJar.value = token;

        const logoutRes = await logoutPost(makePostRequest("/api/auth/logout", {}));
        expect(logoutRes.status).toBe(200);
        expect(await getSessionFromToken(conn.db, token)).toBeNull();
    });

    it("enforces non-enumeration 401 and 5-failure student ID cooldown 429", async () => {
        const ip = `10.21.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
        const member = await seedTestUser({ systemRole: "MEMBER" });
        createdRateKeys.push(`login:ip:${ip}`, `login:id:${member.user.studentIdNumber.toLowerCase()}`);

        const unknownRes = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: "UNKNOWN-99999", password: "wrong" },
                { ip },
            ),
        );
        createdRateKeys.push("login:id:unknown-99999");

        const badPwRes = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: member.user.studentIdNumber, password: "wrong-password" },
                { ip },
            ),
        );

        expect(unknownRes.status).toBe(401);
        expect(badPwRes.status).toBe(401);
        expect(await unknownRes.json()).toEqual(await badPwRes.json());

        for (let i = 0; i < 4; i++) {
            await loginPost(
                makePostRequest(
                    "/api/auth/login",
                    { studentIdNumber: member.user.studentIdNumber, password: "wrong-password" },
                    { ip },
                ),
            );
        }

        const lockedRes = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: member.user.studentIdNumber, password: member.defaultPw },
                { ip },
            ),
        );
        expect(lockedRes.status).toBe(429);
        expect(await lockedRes.json()).toMatchObject({ error: { code: "LOGIN_COOLDOWN" } });
    });

    it("returns 403 ACCOUNT_HOLD and revokes sessions for DISABLED/NEEDS_REVIEW after credential check", async () => {
        const ip = `10.22.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
        createdRateKeys.push(`login:ip:${ip}`);

        const disabled = await seedTestUser({ accountStatus: "DISABLED" });
        const existingSession = await createSession(conn.db, {
            userId: disabled.user.id,
            roleTierSnapshot: "MEMBER",
        });

        const holdRes = await loginPost(
            makePostRequest(
                "/api/auth/login",
                { studentIdNumber: disabled.user.studentIdNumber, password: disabled.defaultPw },
                { ip },
            ),
        );
        expect(holdRes.status).toBe(403);
        expect(await holdRes.json()).toMatchObject({ error: { code: "ACCOUNT_HOLD" } });
        expect(await getSessionFromToken(conn.db, existingSession.token)).toBeNull();
    });

    it("binds @hnu.edu.ph email via OTP, locks after 5 bad codes, blocks replay, and audits", async () => {
        const officer = await seedTestUser({ systemRole: "OFFICER" });
        const sess = await createSession(conn.db, {
            userId: officer.user.id,
            roleTierSnapshot: "OFFICER",
        });
        cookieJar.value = sess.token;
        createdRateKeys.push(`otp:15m:user:${officer.user.id}`, `otp:1h:user:${officer.user.id}`);

        const badDomain = await requestOtpPost(
            makePostRequest("/api/auth/email/request-otp", { email: "student@gmail.com" }),
        );
        expect(badDomain.status).toBe(400);

        const targetEmail = `${officer.user.studentIdNumber.toLowerCase()}@hnu.edu.ph`;
        const reqOtp = await requestOtpPost(
            makePostRequest("/api/auth/email/request-otp", { email: targetEmail }),
        );
        expect(reqOtp.status).toBe(200);

        for (let i = 0; i < 4; i++) {
            const badVerify = await verifyOtpPost(
                makePostRequest("/api/auth/email/verify-otp", {
                    email: targetEmail,
                    code: "000000",
                }),
            );
            expect(badVerify.status).toBe(400);
        }

        const fifthVerify = await verifyOtpPost(
            makePostRequest("/api/auth/email/verify-otp", {
                email: targetEmail,
                code: "000000",
            }),
        );
        expect(fifthVerify.status).toBe(429);
        expect(await fifthVerify.json()).toMatchObject({ error: { code: "OTP_LOCKED" } });
    });

    it("rotates session on password change and enforces policy + audit on password reset", async () => {
        const ip = `10.23.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
        const member = await seedTestUser({
            systemRole: "MEMBER",
            universityEmail: `verified-${randomUUID().slice(0, 6)}@hnu.edu.ph`,
            emailVerifiedAt: new Date(),
        });
        createdRateKeys.push(
            `reset:ip:${ip}`,
            `reset:confirm:ip:${ip}`,
            `reset:15m:id:${member.user.studentIdNumber.toLowerCase()}`,
            `reset:1h:id:${member.user.studentIdNumber.toLowerCase()}`,
        );

        const s1 = await createSession(conn.db, {
            userId: member.user.id,
            roleTierSnapshot: "MEMBER",
        });
        cookieJar.value = s1.token;

        const weakChange = await changePasswordPost(
            makePostRequest("/api/auth/password/change", {
                currentPassword: member.defaultPw,
                newPassword: "weak",
            }),
        );
        expect(weakChange.status).toBe(400);

        const changeRes = await changePasswordPost(
            makePostRequest("/api/auth/password/change", {
                currentPassword: member.defaultPw,
                newPassword: "UpdatedStrongPass123",
            }),
        );
        expect(changeRes.status).toBe(200);
        expect(await getSessionFromToken(conn.db, s1.token)).toBeNull();
        const rotatedToken = extractSessionCookie(changeRes.headers.get("set-cookie"));
        expect(rotatedToken).toBeTruthy();

        const resetReq = await resetRequestPost(
            makePostRequest(
                "/api/auth/password/reset-request",
                {
                    studentIdNumber: member.user.studentIdNumber,
                    email: member.user.universityEmail,
                },
                { ip },
            ),
        );
        expect(resetReq.status).toBe(200);

        // Non-verified account still returns generic 200 (non-enumeration)
        const unverifiedReq = await resetRequestPost(
            makePostRequest(
                "/api/auth/password/reset-request",
                {
                    studentIdNumber: "NO-SUCH-ID",
                    email: "nobody@hnu.edu.ph",
                },
                { ip },
            ),
        );
        expect(unverifiedReq.status).toBe(200);
        expect(await unverifiedReq.json()).toEqual(await resetReq.json());

        // Verify password change audit log exists without leaking passwordHash
        const logs = await conn.db
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.entityId, member.user.id));
        expect(logs.some((l) => l.action === "USER_PASSWORD_CHANGED")).toBe(true);
        expect(JSON.stringify(logs)).not.toContain("UpdatedStrongPass123");

        // Confirm reset-confirm rejects weak password cleanly
        const weakReset = await resetConfirmPost(
            makePostRequest(
                "/api/auth/password/reset-confirm",
                {
                    studentIdNumber: member.user.studentIdNumber,
                    email: member.user.universityEmail,
                    code: "123456",
                    newPassword: "short",
                },
                { ip },
            ),
        );
        expect(weakReset.status).toBe(400);
        expect(await weakReset.json()).toMatchObject({ error: { code: "WEAK_PASSWORD" } });
    });

    it("completes full email OTP verification and verified password reset end-to-end with audit logs", async () => {
        const ip = `10.24.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
        const student = await seedTestUser({ systemRole: "MEMBER" });
        const targetEmail = `${student.user.studentIdNumber.toLowerCase()}@hnu.edu.ph`;
        createdRateKeys.push(
            `otp:15m:user:${student.user.id}`,
            `otp:1h:user:${student.user.id}`,
            `reset:ip:${ip}`,
            `reset:confirm:ip:${ip}`,
            `reset:15m:id:${student.user.studentIdNumber.toLowerCase()}`,
            `reset:1h:id:${student.user.studentIdNumber.toLowerCase()}`,
            `login:ip:${ip}`,
            `login:id:${student.user.studentIdNumber.toLowerCase()}`,
        );

        const sentCodes: string[] = [];
        const sendSpy = vi
            .spyOn(ConsoleEmailProvider.prototype, "send")
            .mockImplementation(async (input) => {
                const match = input.text.match(/\b(\d{6})\b/);
                if (match?.[1]) {
                    sentCodes.push(match[1]);
                }
                return { messageId: "test-msg" };
            });

        try {
            const s1 = await createSession(conn.db, {
                userId: student.user.id,
                roleTierSnapshot: "MEMBER",
            });
            cookieJar.value = s1.token;

            const reqOtp = await requestOtpPost(
                makePostRequest("/api/auth/email/request-otp", { email: targetEmail }),
            );
            expect(reqOtp.status).toBe(200);
            expect(sentCodes).toHaveLength(1);

            const verifyRes = await verifyOtpPost(
                makePostRequest("/api/auth/email/verify-otp", {
                    email: targetEmail,
                    code: sentCodes[0],
                }),
            );
            expect(verifyRes.status).toBe(200);
            const verifyBody = await verifyRes.json();
            expect(verifyBody.data.user.emailVerified).toBe(true);

            // Replay of consumed OTP fails
            const replayRes = await verifyOtpPost(
                makePostRequest("/api/auth/email/verify-otp", {
                    email: targetEmail,
                    code: sentCodes[0],
                }),
            );
            expect(replayRes.status).toBe(400);

            // Request & confirm password reset
            const resetReq = await resetRequestPost(
                makePostRequest(
                    "/api/auth/password/reset-request",
                    { studentIdNumber: student.user.studentIdNumber, email: targetEmail },
                    { ip },
                ),
            );
            expect(resetReq.status).toBe(200);
            expect(sentCodes).toHaveLength(2);

            const resetConfirm = await resetConfirmPost(
                makePostRequest(
                    "/api/auth/password/reset-confirm",
                    {
                        studentIdNumber: student.user.studentIdNumber,
                        email: targetEmail,
                        code: sentCodes[1],
                        newPassword: "RecoveredStrongPass123",
                    },
                    { ip },
                ),
            );
            expect(resetConfirm.status).toBe(200);

            // Prior session revoked and mustChangePassword cleared
            expect(await getSessionFromToken(conn.db, s1.token)).toBeNull();
            const loginNewPw = await loginPost(
                makePostRequest(
                    "/api/auth/login",
                    {
                        studentIdNumber: student.user.studentIdNumber,
                        password: "RecoveredStrongPass123",
                    },
                    { ip },
                ),
            );
            expect(loginNewPw.status).toBe(200);
            const loginBody = await loginNewPw.json();
            expect(loginBody.data.user.mustChangePassword).toBe(false);

            const logs = await conn.db
                .select()
                .from(auditLogs)
                .where(eq(auditLogs.entityId, student.user.id));
            expect(logs.some((l) => l.action === "USER_EMAIL_VERIFIED")).toBe(true);
            expect(logs.some((l) => l.action === "USER_PASSWORD_RESET")).toBe(true);
        } finally {
            sendSpy.mockRestore();
        }
    });
});
