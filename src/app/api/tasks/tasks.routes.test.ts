import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    academicTerms,
    auditLogs,
    eventCommittees,
    events,
    officerAppointments,
    tasks,
    userSessions,
    users,
} from "@/db/schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";

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

import { DELETE as taskByIdDelete, GET as taskByIdGet, PATCH as taskByIdPatch } from "./[id]/route";
import { GET as tasksGet, POST as tasksPost } from "./route";

const directUrl = process.env.DIRECT_DATABASE_URL;

function makeJsonRequest(
    path: string,
    method: string,
    body?: unknown,
    options?: { origin?: string | null },
) {
    const headers: Record<string, string> = {};
    if (options?.origin !== null) {
        headers.origin = options?.origin ?? "http://localhost:3000";
    }
    if (body !== undefined) {
        headers["content-type"] = "application/json";
    }
    return new Request(`http://localhost:3000${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

describe.skipIf(!directUrl)("M3B Tasks & Deliverables routes (local Supabase)", () => {
    let conn: DbConnection;
    let activeTermId: string;
    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });
        const [activeTerm] = await conn.db
            .select({ id: academicTerms.id })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            throw new Error("Expected a seeded ACTIVE academic term for M3B Tasks tests.");
        }
        activeTermId = activeTerm.id;
    });

    afterAll(async () => {
        if (!conn) return;
        // Historical tables prohibit hard delete; clean up tasks & sessions only
        if (createdTaskIds.length > 0) {
            await conn.db.delete(tasks).where(inArray(tasks.id, createdTaskIds));
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
        opts?: { withAppointment?: boolean },
    ) {
        const suffix = randomUUID().slice(0, 8);
        const studentId = `TK-${suffix}`;
        const passwordHash = await hashPassword(normalizeDefaultPassword("Tasks", studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "Tasks",
                lastName: suffix,
                fullName: `Tasks ${suffix}`,
                passwordHash,
                mustChangePassword: false,
                systemRole: role,
                accountStatus: "ACTIVE",
            })
            .returning();
        createdUserIds.push(user.id);

        if (opts?.withAppointment) {
            await conn.db.insert(officerAppointments).values({
                userId: user.id,
                academicTermId: activeTermId,
                positionTitle: role === "EXECUTIVE" ? "VP Operations" : "Committee Member",
                grantedSystemRole: role === "MEMBER" ? "OFFICER" : role,
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

    async function seedEvent(
        creatorId: string,
        opts: {
            termId?: string;
            status: "DRAFT" | "APPROVED" | "PUBLISHED" | "COMPLETED";
        },
    ) {
        const suffix = randomUUID().slice(0, 8);
        const now = new Date();
        const [ev] = await conn.db
            .insert(events)
            .values({
                academicTermId: opts.termId ?? activeTermId,
                title: `Task Test Event ${suffix}`,
                slug: `task-test-event-${suffix}`,
                descriptionHtml: "<p>Task test event body</p>",
                publicSummary: "Task test event summary",
                venue: "HNU Lab",
                startAt: new Date("2026-11-25T08:00:00+08:00"),
                endAt: new Date("2026-11-25T17:00:00+08:00"),
                status: opts.status,
                createdBy: creatorId,
                approvedBy: opts.status !== "DRAFT" ? creatorId : null,
                approvedAt: opts.status !== "DRAFT" ? now : null,
                publishedBy:
                    opts.status === "PUBLISHED" || opts.status === "COMPLETED" ? creatorId : null,
                publishedAt:
                    opts.status === "PUBLISHED" || opts.status === "COMPLETED" ? now : null,
                completedBy: opts.status === "COMPLETED" ? creatorId : null,
                completedAt: opts.status === "COMPLETED" ? now : null,
            })
            .returning();
        return ev;
    }

    it("enforces SEC-TEST-01 (MEMBER 403), BR-TSK-01 (Committee Head vs General scope), SEC-TEST-03 (cross-committee boundary), and BR-TSK-02 (assignee vs reviewer transitions)", async () => {
        const member = await createTestUser("MEMBER");
        const headA = await createTestUser("OFFICER", { withAppointment: true });
        const headB = await createTestUser("OFFICER", { withAppointment: true });
        const assigneeOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const unassignedOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const executive = await createTestUser("EXECUTIVE", { withAppointment: true });

        const draftEvent = await seedEvent(executive.user.id, { status: "DRAFT" });
        const activeEvent = await seedEvent(executive.user.id, { status: "PUBLISHED" });

        const [comA] = await conn.db
            .insert(eventCommittees)
            .values({
                eventId: activeEvent.id,
                name: `Logistics-${randomUUID().slice(0, 6)}`,
                headUserId: headA.user.id,
                createdBy: executive.user.id,
            })
            .returning();
        const [comB] = await conn.db
            .insert(eventCommittees)
            .values({
                eventId: activeEvent.id,
                name: `Technical-${randomUUID().slice(0, 6)}`,
                headUserId: headB.user.id,
                createdBy: executive.user.id,
            })
            .returning();

        // Unauthenticated -> 401
        cookieJar.value = undefined;
        expect((await tasksGet(makeJsonRequest("/api/tasks", "GET"))).status).toBe(401);

        // SEC-TEST-01: MEMBER gets 403 before payload validation
        cookieJar.value = member.token;
        expect((await tasksGet(makeJsonRequest("/api/tasks", "GET"))).status).toBe(403);
        expect((await tasksPost(makeJsonRequest("/api/tasks", "POST", {}))).status).toBe(403);

        // Pre-approval DRAFT event rejects task creation with 409 EVENT_NOT_APPROVED
        cookieJar.value = executive.token;
        const draftTaskRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: "Blocked Draft Event Task",
                eventId: draftEvent.id,
            }),
        );
        expect(draftTaskRes.status).toBe(409);
        expect(await draftTaskRes.json()).toMatchObject({
            error: { code: "EVENT_NOT_APPROVED" },
        });

        // BR-TSK-01: Head A can create a task in Committee A and assign active officer
        cookieJar.value = headA.token;
        const memberAssigneeRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: "Member Assignee Blocked",
                eventId: activeEvent.id,
                committeeId: comA.id,
                assigneeIds: [member.user.id],
            }),
        );
        expect(memberAssigneeRes.status).toBe(400);
        expect(await memberAssigneeRes.json()).toMatchObject({
            error: { code: "INVALID_TASK_ASSIGNEE" },
        });

        const createComATaskRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: "Book PA sound system",
                description: "Confirm microphones and mixer.",
                eventId: activeEvent.id,
                committeeId: comA.id,
                priority: "HIGH",
                dueAt: "2026-11-24T17:00:00+08:00",
                assigneeIds: [assigneeOfficer.user.id],
            }),
        );
        expect(createComATaskRes.status).toBe(201);
        const createdComAPayload = (await createComATaskRes.json()) as {
            data: {
                task: { id: string; status: string };
                eventSummary: {
                    taskCount: number;
                    completedTaskCount: number;
                    byCommittee: Record<string, { total: number; done: number }>;
                };
            };
        };
        const taskAId = createdComAPayload.data.task.id;
        createdTaskIds.push(taskAId);
        expect(createdComAPayload.data.eventSummary.taskCount).toBe(1);
        expect(createdComAPayload.data.eventSummary.byCommittee[comA.id]).toEqual({
            total: 1,
            done: 0,
        });

        // SEC-TEST-03: Head A cannot create task in Committee B (403) or Event-Wide/General (403)
        const crossComCreateRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: "Cross-committee create",
                eventId: activeEvent.id,
                committeeId: comB.id,
            }),
        );
        expect(crossComCreateRes.status).toBe(403);
        expect(await crossComCreateRes.json()).toMatchObject({
            error: { code: "COMMITTEE_HEAD_REQUIRED" },
        });

        expect(
            (
                await tasksPost(
                    makeJsonRequest("/api/tasks", "POST", {
                        title: "Officer General Task Blocked",
                    }),
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await tasksPost(
                    makeJsonRequest("/api/tasks", "POST", {
                        title: "Officer Event-Wide Task Blocked",
                        eventId: activeEvent.id,
                    }),
                )
            ).status,
        ).toBe(403);

        // BR-TSK-02: Unassigned Officer cannot progress taskA (403 NOT_TASK_ASSIGNEE)
        cookieJar.value = unassignedOfficer.token;
        const unassignedRes = await taskByIdPatch(
            makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "IN_PROGRESS" }),
            { params: Promise.resolve({ id: taskAId }) },
        );
        expect(unassignedRes.status).toBe(403);
        expect(await unassignedRes.json()).toMatchObject({
            error: { code: "NOT_TASK_ASSIGNEE" },
        });

        // Assigned Officer sees task under scope=mine and progresses TO_DO -> IN_PROGRESS -> FOR_REVIEW
        cookieJar.value = assigneeOfficer.token;
        const mineRes = await tasksGet(makeJsonRequest("/api/tasks?scope=mine", "GET"));
        expect(mineRes.status).toBe(200);
        const mineItems = ((await mineRes.json()) as { data: { items: Array<{ id: string }> } })
            .data.items;
        expect(mineItems.some((t) => t.id === taskAId)).toBe(true);

        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "IN_PROGRESS" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(200);
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "FOR_REVIEW" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(200);

        // Assigned Officer CANNOT mark DONE, return FOR_REVIEW -> IN_PROGRESS, edit metadata, or delete (403)
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "DONE" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "IN_PROGRESS" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { title: "Tampered Title" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await taskByIdDelete(makeJsonRequest(`/api/tasks/${taskAId}`, "DELETE", {}), {
                    params: Promise.resolve({ id: taskAId }),
                })
            ).status,
        ).toBe(403);

        // Head B cannot mark Head A's task DONE (403 SEC-TEST-03)
        cookieJar.value = headB.token;
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "DONE" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(403);

        // Head A returns FOR_REVIEW -> IN_PROGRESS, marks DONE (completedBy/completedAt set), reopens (cleared), then marks DONE
        cookieJar.value = headA.token;
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "IN_PROGRESS" }),
                    { params: Promise.resolve({ id: taskAId }) },
                )
            ).status,
        ).toBe(200);

        const doneRes = await taskByIdPatch(
            makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "DONE" }),
            { params: Promise.resolve({ id: taskAId }) },
        );
        expect(doneRes.status).toBe(200);
        const donePayload = (await doneRes.json()) as {
            data: {
                task: { status: string; completedBy: { id: string } | null; completedAt: string | null };
                eventSummary: { completedTaskCount: number };
            };
        };
        expect(donePayload.data.task.status).toBe("DONE");
        expect(donePayload.data.task.completedBy?.id).toBe(headA.user.id);
        expect(donePayload.data.task.completedAt).toBeTruthy();
        expect(donePayload.data.eventSummary.completedTaskCount).toBe(1);

        const reopenRes = await taskByIdPatch(
            makeJsonRequest(`/api/tasks/${taskAId}`, "PATCH", { status: "IN_PROGRESS" }),
            { params: Promise.resolve({ id: taskAId }) },
        );
        expect(reopenRes.status).toBe(200);
        const reopenPayload = (await reopenRes.json()) as {
            data: {
                task: { completedBy: unknown; completedAt: string | null };
                eventSummary: { completedTaskCount: number };
            };
        };
        expect(reopenPayload.data.task.completedBy).toBeNull();
        expect(reopenPayload.data.task.completedAt).toBeNull();
        expect(reopenPayload.data.eventSummary.completedTaskCount).toBe(0);

        // Executive creates Event-Wide and General Org tasks
        cookieJar.value = executive.token;
        const generalRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: "Submit semester org compliance packet",
                priority: "URGENT",
                assigneeIds: [executive.user.id],
            }),
        );
        expect(generalRes.status).toBe(201);
        const generalTaskId = (
            (await generalRes.json()) as { data: { task: { id: string } } }
        ).data.task.id;
        createdTaskIds.push(generalTaskId);

        const detailRes = await taskByIdGet(makeJsonRequest(`/api/tasks/${generalTaskId}`, "GET"), {
            params: Promise.resolve({ id: generalTaskId }),
        });
        expect(detailRes.status).toBe(200);
    });

    it("enforces BR-TSK-03 locked-event & closed-term locks, SEC-TEST-08 break-glass, CSRF, escaped LIKE search, and overdue filters", async () => {
        const executive = await createTestUser("EXECUTIVE", { withAppointment: true });
        const superAdmin = await createTestUser("SUPER_ADMIN");

        cookieJar.value = executive.token;

        // CSRF Origin check -> 403
        const csrfRes = await tasksPost(
            makeJsonRequest(
                "/api/tasks",
                "POST",
                { title: "CSRF Blocked Task" },
                { origin: null },
            ),
        );
        expect(csrfRes.status).toBe(403);
        expect(await csrfRes.json()).toMatchObject({ error: { code: "CSRF_FORBIDDEN" } });

        // Overdue + escaped LIKE search test with unique literal % and _
        const uniqueLiteral = `100%_Deliverable_${randomUUID().slice(0, 6)}`;
        const overdueRes = await tasksPost(
            makeJsonRequest("/api/tasks", "POST", {
                title: `${uniqueLiteral}_Check`,
                dueAt: "2025-01-10T10:00:00+08:00",
                priority: "HIGH",
            }),
        );
        expect(overdueRes.status).toBe(201);
        const overdueTaskId = (
            (await overdueRes.json()) as { data: { task: { id: string; isOverdue: boolean } } }
        ).data.task.id;
        createdTaskIds.push(overdueTaskId);

        const searchRes = await tasksGet(
            makeJsonRequest(
                `/api/tasks?overdueOnly=true&q=${encodeURIComponent(uniqueLiteral)}`,
                "GET",
            ),
        );
        expect(searchRes.status).toBe(200);
        const foundItems = (
            (await searchRes.json()) as { data: { items: Array<{ id: string; isOverdue: boolean }> } }
        ).data.items;
        expect(foundItems.map((t) => t.id)).toEqual([overdueTaskId]);
        expect(foundItems[0]?.isOverdue).toBe(true);

        // COMPLETED event locks tasks for EXECUTIVE (409 RESOURCE_LOCKED)
        const completedEvent = await seedEvent(executive.user.id, { status: "COMPLETED" });
        const [frozenTask] = await conn.db
            .insert(tasks)
            .values({
                academicTermId: activeTermId,
                eventId: completedEvent.id,
                title: "Frozen Post-Event Deliverable",
                status: "IN_PROGRESS",
                priority: "MEDIUM",
                createdBy: executive.user.id,
            })
            .returning();
        createdTaskIds.push(frozenTask.id);

        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${frozenTask.id}`, "PATCH", { status: "DONE" }),
                    { params: Promise.resolve({ id: frozenTask.id }) },
                )
            ).status,
        ).toBe(409);

        expect(
            (
                await taskByIdDelete(makeJsonRequest(`/api/tasks/${frozenTask.id}`, "DELETE", {}), {
                    params: Promise.resolve({ id: frozenTask.id }),
                })
            ).status,
        ).toBe(409);

        // CLOSED term task also returns 409 for EXECUTIVE
        const closedCode = `TK-CLOSED-${randomUUID().slice(0, 6)}`;
        const [closedTerm] = await conn.db
            .insert(academicTerms)
            .values({
                code: closedCode,
                name: `Closed ${closedCode}`,
                startDate: "2025-01-01",
                endDate: "2025-05-01",
                status: "CLOSED",
                closedAt: new Date(),
                createdBy: superAdmin.user.id,
            })
            .returning();
        const [closedTask] = await conn.db
            .insert(tasks)
            .values({
                academicTermId: closedTerm.id,
                title: "Closed Term Task",
                status: "TO_DO",
                priority: "LOW",
                createdBy: executive.user.id,
            })
            .returning();
        createdTaskIds.push(closedTask.id);

        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${closedTask.id}`, "PATCH", {
                        title: "Blocked Closed Term Edit",
                    }),
                    { params: Promise.resolve({ id: closedTask.id }) },
                )
            ).status,
        ).toBe(409);

        // SEC-TEST-08: SUPER_ADMIN requires breakGlass + >=10 char reason on locked task; succeeds & audits with break_glass: true
        cookieJar.value = superAdmin.token;
        expect(
            (
                await taskByIdPatch(
                    makeJsonRequest(`/api/tasks/${frozenTask.id}`, "PATCH", { status: "DONE" }),
                    { params: Promise.resolve({ id: frozenTask.id }) },
                )
            ).status,
        ).toBe(400);

        const bgCompleteRes = await taskByIdPatch(
            makeJsonRequest(`/api/tasks/${frozenTask.id}`, "PATCH", {
                status: "DONE",
                breakGlass: true,
                reason: "Closing verified deliverable missed before event archival.",
            }),
            { params: Promise.resolve({ id: frozenTask.id }) },
        );
        expect(bgCompleteRes.status).toBe(200);

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "task"),
                    eq(auditLogs.entityId, frozenTask.id),
                    eq(auditLogs.action, "TASK_COMPLETED"),
                ),
            )
            .orderBy(desc(auditLogs.createdAt))
            .limit(1);
        expect((bgAudit.afterState as Record<string, unknown> | null)?.break_glass).toBe(true);

        // SUPER_ADMIN break-glass delete writes TASK_DELETED audit log
        const bgDeleteRes = await taskByIdDelete(
            makeJsonRequest(`/api/tasks/${closedTask.id}`, "DELETE", {
                breakGlass: true,
                reason: "Removing duplicate historical task created in error.",
            }),
            { params: Promise.resolve({ id: closedTask.id }) },
        );
        expect(bgDeleteRes.status).toBe(200);

        const [delAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "task"),
                    eq(auditLogs.entityId, closedTask.id),
                    eq(auditLogs.action, "TASK_DELETED"),
                ),
            )
            .limit(1);
        expect(delAudit).toBeDefined();
    });
});
