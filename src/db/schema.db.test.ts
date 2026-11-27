import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbConnection } from "./index";
import {
    academicTerms,
    attendanceCheckpoints,
    attendanceRecords,
    auditLogs,
    eventCommittees,
    events,
    meetings,
    officerAppointments,
    tasks,
    users,
} from "./schema";
import { consumeVerificationOtp, issueVerificationOtp } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { createSession, getSessionFromToken, revokeAllUserSessions } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const ALL_21_TABLES = [
    "academic_terms",
    "announcements",
    "attendance_checkpoints",
    "attendance_records",
    "audit_logs",
    "document_types",
    "documents",
    "drive_folder_cache",
    "event_committee_members",
    "event_committees",
    "event_proposal_reviews",
    "events",
    "masterlist_imports",
    "meetings",
    "officer_appointments",
    "rate_limit_buckets",
    "task_assignees",
    "tasks",
    "user_sessions",
    "users",
    "verification_tokens",
];

const directUrl = process.env.DIRECT_DATABASE_URL;

describe.skipIf(!directUrl)("M1 real-PostgreSQL schema, RLS, triggers, and security integration", () => {
    let conn: DbConnection;

    beforeAll(() => {
        conn = createDb(directUrl!, { max: 2 });
    });

    afterAll(async () => {
        await conn.client.end();
    });

    it("enables RLS with zero anon/authenticated policies on all 21 tables", async () => {
        const tables = await conn.client<{ tablename: string; rowsecurity: boolean }[]>`
            SELECT tablename, rowsecurity
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `;

        const tableMap = new Map(tables.map((t) => [t.tablename, t.rowsecurity]));
        for (const name of ALL_21_TABLES) {
            expect(tableMap.get(name), `Missing or RLS-disabled table: ${name}`).toBe(true);
        }

        const policies = await conn.client<{ tablename: string; policyname: string }[]>`
            SELECT tablename, policyname
            FROM pg_policies
            WHERE schemaname = 'public'
        `;
        expect(policies).toHaveLength(0);
    });

    it("denies PostgREST anon and authenticated roles from reading/writing tables", async () => {
        for (const role of ["anon", "authenticated"] as const) {
            await conn.db
                .transaction(async (tx) => {
                    await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
                    const rows = await tx.select({ id: users.id }).from(users);
                    expect(rows).toHaveLength(0);

                    await tx.execute(sql`SAVEPOINT sp_rls`);
                    await expect(
                        tx.insert(auditLogs).values({
                            action: "BYPASS_TEST",
                            entityType: "user",
                            entityId: randomUUID(),
                        }),
                    ).rejects.toThrow();
                    await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_rls`);

                    tx.rollback();
                })
                .catch((err) => {
                    if (!(err instanceof Error && err.message === "Rollback")) {
                        throw err;
                    }
                });
        }
    });

    it("enforces audit_logs immutability and historical zero-hard-delete triggers", async () => {
        await conn.db
            .transaction(async (tx) => {
                const pwHash = await hashPassword("TestPass1234!");
                const [u] = await tx
                    .insert(users)
                    .values({
                        studentIdNumber: `TEST-${randomUUID().slice(0, 8)}`,
                        firstName: "Hist",
                        lastName: "Guard",
                        fullName: "Hist Guard",
                        passwordHash: pwHash,
                    })
                    .returning();

                const [term] = await tx
                    .insert(academicTerms)
                    .values({
                        code: `T-${randomUUID().slice(0, 8)}`,
                        name: `Term ${randomUUID().slice(0, 8)}`,
                        startDate: "2027-01-01",
                        endDate: "2027-05-01",
                        status: "DRAFT",
                        createdBy: u.id,
                    })
                    .returning();

                const [appt] = await tx
                    .insert(officerAppointments)
                    .values({
                        userId: u.id,
                        academicTermId: term.id,
                        positionTitle: "Secretary",
                        grantedSystemRole: "OFFICER",
                        appointedBy: u.id,
                    })
                    .returning();

                const [ev] = await tx
                    .insert(events)
                    .values({
                        academicTermId: term.id,
                        title: "Sample Event",
                        slug: `ev-${randomUUID().slice(0, 8)}`,
                        descriptionHtml: "<p>Hello</p>",
                        startAt: new Date("2027-02-01T08:00:00Z"),
                        endAt: new Date("2027-02-01T12:00:00Z"),
                        createdBy: u.id,
                    })
                    .returning();

                const [mtg] = await tx
                    .insert(meetings)
                    .values({
                        academicTermId: term.id,
                        title: "Sample Meeting",
                        scheduledStartAt: new Date("2027-02-02T08:00:00Z"),
                        createdBy: u.id,
                    })
                    .returning();

                const [cp] = await tx
                    .insert(attendanceCheckpoints)
                    .values({
                        eventId: ev.id,
                        label: "Check-In",
                        createdBy: u.id,
                    })
                    .returning();

                const [att] = await tx
                    .insert(attendanceRecords)
                    .values({
                        checkpointId: cp.id,
                        userId: u.id,
                        recordedBy: u.id,
                    })
                    .returning();

                const [log] = await tx
                    .insert(auditLogs)
                    .values({
                        actorId: u.id,
                        action: "TEST_LOG",
                        entityType: "user",
                        entityId: u.id,
                    })
                    .returning();

                // Verify savepoints around each prohibited operation inside the rolled-back tx
                for (const stmt of [
                    sql`UPDATE audit_logs SET reason = 'tampered' WHERE id = ${log.id}`,
                    sql`DELETE FROM audit_logs WHERE id = ${log.id}`,
                    sql`DELETE FROM attendance_records WHERE id = ${att.id}`,
                    sql`DELETE FROM meetings WHERE id = ${mtg.id}`,
                    sql`DELETE FROM events WHERE id = ${ev.id}`,
                    sql`DELETE FROM officer_appointments WHERE id = ${appt.id}`,
                    sql`DELETE FROM academic_terms WHERE id = ${term.id}`,
                    sql`DELETE FROM users WHERE id = ${u.id}`,
                ]) {
                    await tx.execute(sql`SAVEPOINT sp_guard`);
                    await expect(tx.execute(stmt)).rejects.toThrow();
                    await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_guard`);
                }

                tx.rollback();
            })
            .catch((err) => {
                if (!(err instanceof Error && err.message === "Rollback")) {
                    throw err;
                }
            });
    });

    it("enforces relational invariants, session revocation, OTP 5-attempt lockout, and rate limits", async () => {
        await conn.db
            .transaction(async (tx) => {
                const pwHash = await hashPassword("TestPass1234!");
                const [u] = await tx
                    .insert(users)
                    .values({
                        studentIdNumber: `SEC-${randomUUID().slice(0, 8)}`,
                        firstName: "Sec",
                        lastName: "Tester",
                        fullName: "Sec Tester",
                        passwordHash: pwHash,
                        systemRole: "EXECUTIVE",
                    })
                    .returning();

                // 1. Session create -> lookup -> revokeAllUserSessions
                const sess = await createSession(tx, {
                    userId: u.id,
                    roleTierSnapshot: u.systemRole,
                });
                const active = await getSessionFromToken(tx, sess.token);
                expect(active?.user.id).toBe(u.id);

                await revokeAllUserSessions(tx, u.id);
                const revoked = await getSessionFromToken(tx, sess.token);
                expect(revoked).toBeNull();

                // 2. OTP 5-attempt lockout & replay guard
                const secret = "test-otp-hmac-secret-at-least-32-characters";
                const otp1 = await issueVerificationOtp(tx, {
                    userId: u.id,
                    purpose: "EMAIL_VERIFICATION",
                    targetEmail: "sec.tester@hnu.edu.ph",
                    universityDomain: "hnu.edu.ph",
                    hmacSecret: secret,
                });

                for (let i = 0; i < 4; i++) {
                    const bad = await consumeVerificationOtp(tx, {
                        userId: u.id,
                        purpose: "EMAIL_VERIFICATION",
                        targetEmail: "sec.tester@hnu.edu.ph",
                        code: otp1.code === "999999" ? "888888" : "999999",
                        universityDomain: "hnu.edu.ph",
                        hmacSecret: secret,
                    });
                    expect(bad).toEqual({ ok: false, reason: "INVALID_CODE" });
                }

                const fifth = await consumeVerificationOtp(tx, {
                    userId: u.id,
                    purpose: "EMAIL_VERIFICATION",
                    targetEmail: "sec.tester@hnu.edu.ph",
                    code: otp1.code === "999999" ? "888888" : "999999",
                    universityDomain: "hnu.edu.ph",
                    hmacSecret: secret,
                });
                expect(fifth).toEqual({ ok: false, reason: "MAX_ATTEMPTS" });

                const otp2 = await issueVerificationOtp(tx, {
                    userId: u.id,
                    purpose: "EMAIL_VERIFICATION",
                    targetEmail: "sec.tester@hnu.edu.ph",
                    universityDomain: "hnu.edu.ph",
                    hmacSecret: secret,
                });
                const ok = await consumeVerificationOtp(tx, {
                    userId: u.id,
                    purpose: "EMAIL_VERIFICATION",
                    targetEmail: "sec.tester@hnu.edu.ph",
                    code: otp2.code,
                    universityDomain: "hnu.edu.ph",
                    hmacSecret: secret,
                });
                expect(ok.ok).toBe(true);

                const replay = await consumeVerificationOtp(tx, {
                    userId: u.id,
                    purpose: "EMAIL_VERIFICATION",
                    targetEmail: "sec.tester@hnu.edu.ph",
                    code: otp2.code,
                    universityDomain: "hnu.edu.ph",
                    hmacSecret: secret,
                });
                expect(replay).toEqual({ ok: false, reason: "INVALID_OR_EXPIRED" });

                // 3. Composite FK on tasks (committee_id, event_id)
                const [term] = await tx
                    .insert(academicTerms)
                    .values({
                        code: `T2-${randomUUID().slice(0, 8)}`,
                        name: `Term2 ${randomUUID().slice(0, 8)}`,
                        startDate: "2027-06-01",
                        endDate: "2027-10-01",
                        status: "DRAFT",
                        createdBy: u.id,
                    })
                    .returning();

                const [evA] = await tx
                    .insert(events)
                    .values({
                        academicTermId: term.id,
                        title: "Event A",
                        slug: `a-${randomUUID().slice(0, 8)}`,
                        descriptionHtml: "<p>A</p>",
                        startAt: new Date("2027-07-01T08:00:00Z"),
                        endAt: new Date("2027-07-01T10:00:00Z"),
                        createdBy: u.id,
                    })
                    .returning();

                const [evB] = await tx
                    .insert(events)
                    .values({
                        academicTermId: term.id,
                        title: "Event B",
                        slug: `b-${randomUUID().slice(0, 8)}`,
                        descriptionHtml: "<p>B</p>",
                        startAt: new Date("2027-07-02T08:00:00Z"),
                        endAt: new Date("2027-07-02T10:00:00Z"),
                        createdBy: u.id,
                    })
                    .returning();

                const [commA] = await tx
                    .insert(eventCommittees)
                    .values({
                        eventId: evA.id,
                        name: "Logistics",
                        headUserId: u.id,
                        createdBy: u.id,
                    })
                    .returning();

                await tx.execute(sql`SAVEPOINT sp_fk`);
                await expect(
                    tx.insert(tasks).values({
                        academicTermId: term.id,
                        eventId: evB.id,
                        committeeId: commA.id,
                        title: "Cross-event mismatch",
                        createdBy: u.id,
                    }),
                ).rejects.toThrow();
                await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_fk`);

                // 4. Rate limit bucket atomic cap
                const rlKey = `test:login:${randomUUID()}`;
                const r1 = await consumeRateLimit(tx, { key: rlKey, limit: 2, windowMs: 60_000 });
                const r2 = await consumeRateLimit(tx, { key: rlKey, limit: 2, windowMs: 60_000 });
                const r3 = await consumeRateLimit(tx, { key: rlKey, limit: 2, windowMs: 60_000 });
                expect(r1.allowed).toBe(true);
                expect(r2.allowed).toBe(true);
                expect(r3.allowed).toBe(false);
                expect(r3.remaining).toBe(0);

                // Avoid unused import warning for eq
                expect(eq).toBeDefined();

                tx.rollback();
            })
            .catch((err) => {
                if (!(err instanceof Error && err.message === "Rollback")) {
                    throw err;
                }
            });
    });
});
