import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type DbConnection } from "@/db";
import {
    academicTerms,
    attendanceCheckpoints,
    auditLogs,
    events,
    officerAppointments,
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

import { GET as portalCalendarGet } from "../portal/calendar/route";
import { DELETE as committeeMemberDelete, POST as committeeMemberPost } from "./[id]/committees/[committeeId]/members/route";
import { PATCH as committeePatch } from "./[id]/committees/[committeeId]/route";
import { GET as committeesGet, POST as committeesPost } from "./[id]/committees/route";
import { GET as reviewsGet, POST as reviewsPost } from "./[id]/reviews/route";
import { GET as eventByIdGet, PATCH as eventByIdPatch } from "./[id]/route";
import { POST as eventTransitionPost } from "./[id]/transition/route";
import { GET as eventsGet, POST as eventsPost } from "./route";

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

describe.skipIf(!directUrl)("M3B Events, Lifecycle, Event Hub & Committees routes (local Supabase)", () => {
    let conn: DbConnection;
    let activeTermId: string;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
        conn = createDb(directUrl!, { max: 2 });
        const [activeTerm] = await conn.db
            .select({ id: academicTerms.id })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            throw new Error("Expected a seeded ACTIVE academic term for M3B route tests.");
        }
        activeTermId = activeTerm.id;
    });

    afterAll(async () => {
        if (!conn) return;
        // Historical tables (events, academic_terms, officer_appointments, users) prohibit hard deletes
        if (createdUserIds.length > 0) {
            await conn.db
                .delete(userSessions)
                .where(inArray(userSessions.userId, createdUserIds));
        }
        await conn.client.end();
    });

    async function createTestUser(
        role: "SUPER_ADMIN" | "EXECUTIVE" | "OFFICER" | "MEMBER",
        opts?: { withAppointment?: boolean; positionTitle?: string },
    ) {
        const suffix = randomUUID().slice(0, 8);
        const studentId = `EV-${suffix}`;
        const passwordHash = await hashPassword(normalizeDefaultPassword("Events", studentId));
        const [user] = await conn.db
            .insert(users)
            .values({
                studentIdNumber: studentId,
                firstName: "Events",
                lastName: suffix,
                fullName: `Events ${suffix}`,
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
                positionTitle: opts.positionTitle ?? (role === "EXECUTIVE" ? "VP Internal" : "Committee Officer"),
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

    it("enforces SEC-TEST-01 (MEMBER 403), BR-EVT-01 (DRAFT isolation), SEC-TEST-02 (OFFICER escalation), and SEC-TEST-06 (XSS sanitization)", async () => {
        const member = await createTestUser("MEMBER");
        const authorOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const otherOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const executive = await createTestUser("EXECUTIVE", { withAppointment: true });

        // Unauthenticated -> 401
        cookieJar.value = undefined;
        expect((await eventsGet(makeJsonRequest("/api/events", "GET"))).status).toBe(401);

        // Author Officer drafts a proposal with XSS payload (SEC-TEST-06)
        cookieJar.value = authorOfficer.token;
        const createRes = await eventsPost(
            makeJsonRequest("/api/events", "POST", {
                title: `SYComP Summit ${randomUUID().slice(0, 6)}`,
                descriptionHtml:
                    '<p>Agenda</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>',
                startAt: "2026-11-10T08:00:00+08:00",
                endAt: "2026-11-10T17:00:00+08:00",
                venue: "HNU Barder Hall",
            }),
        );
        expect(createRes.status).toBe(201);
        const created = (
            (await createRes.json()) as {
                data: { event: { id: string; slug: string; status: string; descriptionHtml: string } };
            }
        ).data.event;
        expect(created.status).toBe("DRAFT");
        expect(created.descriptionHtml).toContain("<p>Agenda</p>");
        expect(created.descriptionHtml).not.toContain("<script>");
        expect(created.descriptionHtml).not.toContain("onerror");
        expect(created.descriptionHtml).not.toContain("javascript:");

        // Duplicate explicit slug in active term -> 409 EVENT_SLUG_CONFLICT
        const dupSlugRes = await eventsPost(
            makeJsonRequest("/api/events", "POST", {
                title: "Duplicate Slug Test",
                slug: created.slug,
                descriptionHtml: "<p>Duplicate slug</p>",
                startAt: "2026-11-11T08:00:00+08:00",
                endAt: "2026-11-11T10:00:00+08:00",
            }),
        );
        expect(dupSlugRes.status).toBe(409);
        expect(await dupSlugRes.json()).toMatchObject({ error: { code: "EVENT_SLUG_CONFLICT" } });

        // SEC-TEST-01 / AC-02: MEMBER gets 403 across all Events & Committees endpoints
        cookieJar.value = member.token;
        expect((await eventsGet(makeJsonRequest("/api/events", "GET"))).status).toBe(403);
        expect(
            (
                await eventByIdGet(makeJsonRequest(`/api/events/${created.slug}`, "GET"), {
                    params: Promise.resolve({ id: created.slug }),
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await eventsPost(
                    makeJsonRequest("/api/events", "POST", {
                        title: "Member Blocked",
                        descriptionHtml: "<p>Nope</p>",
                        startAt: "2026-11-12T08:00:00+08:00",
                        endAt: "2026-11-12T10:00:00+08:00",
                    }),
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await committeesGet(makeJsonRequest(`/api/events/${created.id}/committees`, "GET"), {
                    params: Promise.resolve({ id: created.id }),
                })
            ).status,
        ).toBe(403);

        // BR-EVT-01: Another OFFICER cannot view or edit author's DRAFT proposal (403)
        cookieJar.value = otherOfficer.token;
        const otherListRes = await eventsGet(makeJsonRequest("/api/events", "GET"));
        expect(otherListRes.status).toBe(200);
        const otherList = ((await otherListRes.json()) as { data: { items: Array<{ id: string }> } })
            .data.items;
        expect(otherList.some((e) => e.id === created.id)).toBe(false);

        expect(
            (
                await eventByIdGet(makeJsonRequest(`/api/events/${created.slug}`, "GET"), {
                    params: Promise.resolve({ id: created.slug }),
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await eventByIdPatch(
                    makeJsonRequest(`/api/events/${created.id}`, "PATCH", { title: "Hijacked" }),
                    { params: Promise.resolve({ id: created.id }) },
                )
            ).status,
        ).toBe(403);

        // Author submits DRAFT -> PENDING_REVIEW
        cookieJar.value = authorOfficer.token;
        const submitRes = await eventTransitionPost(
            makeJsonRequest(`/api/events/${created.id}/transition`, "POST", { action: "SUBMIT" }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(submitRes.status).toBe(200);

        // Now otherOfficer CAN see it in open Proposal Workspace and post a review comment
        cookieJar.value = otherOfficer.token;
        expect(
            (
                await eventByIdGet(makeJsonRequest(`/api/events/${created.slug}`, "GET"), {
                    params: Promise.resolve({ id: created.slug }),
                })
            ).status,
        ).toBe(200);
        const commentRes = await reviewsPost(
            makeJsonRequest(`/api/events/${created.id}/reviews`, "POST", {
                feedbackNote: "Suggest adding a dedicated registration table.",
            }),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(commentRes.status).toBe(201);

        // SEC-TEST-02 / AC-03: OFFICER cannot APPROVE, PUBLISH, or create committees (403)
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${created.id}/transition`, "POST", {
                        action: "APPROVE",
                    }),
                    { params: Promise.resolve({ id: created.id }) },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await committeesPost(
                    makeJsonRequest(`/api/events/${created.id}/committees`, "POST", {
                        name: "Unauthorized Committee",
                        headUserId: authorOfficer.user.id,
                    }),
                    { params: Promise.resolve({ id: created.id }) },
                )
            ).status,
        ).toBe(403);

        // Executive sees reviews cleanly via GET /reviews
        cookieJar.value = executive.token;
        const reviewsRes = await reviewsGet(
            makeJsonRequest(`/api/events/${created.id}/reviews`, "GET"),
            { params: Promise.resolve({ id: created.id }) },
        );
        expect(reviewsRes.status).toBe(200);
        expect(
            ((await reviewsRes.json()) as { data: { reviews: Array<{ decisionType: string }> } })
                .data.reviews[0]?.decisionType,
        ).toBe("COMMENT");
    });

    it("executes full proposal lifecycle, AC-04 portal publish gate, AC-05 & SEC-TEST-03 committee scoping, open-checkpoint completion block, and closed/completed locks", async () => {
        const member = await createTestUser("MEMBER");
        const author = await createTestUser("OFFICER", { withAppointment: true });
        const headA = await createTestUser("OFFICER", { withAppointment: true });
        const headB = await createTestUser("OFFICER", { withAppointment: true });
        const rosterOfficer = await createTestUser("OFFICER", { withAppointment: true });
        const executive = await createTestUser("EXECUTIVE", { withAppointment: true });
        const superAdmin = await createTestUser("SUPER_ADMIN");

        // Author creates and submits immediately -> PENDING_REVIEW
        cookieJar.value = author.token;
        const createRes = await eventsPost(
            makeJsonRequest("/api/events", "POST", {
                title: `Hackathon ${randomUUID().slice(0, 6)}`,
                descriptionHtml: "<p>Initial proposal details</p>",
                startAt: "2026-12-01T08:00:00+08:00",
                endAt: "2026-12-01T18:00:00+08:00",
                submitImmediately: true,
            }),
        );
        expect(createRes.status).toBe(201);
        const eventDto = ((await createRes.json()) as { data: { event: { id: string; status: string } } })
            .data.event;
        const eventId = eventDto.id;
        expect(eventDto.status).toBe("PENDING_REVIEW");

        // BR-COM-01: Executive cannot create a committee before APPROVED -> 409 EVENT_NOT_APPROVED
        cookieJar.value = executive.token;
        const preApproveComRes = await committeesPost(
            makeJsonRequest(`/api/events/${eventId}/committees`, "POST", {
                name: "Logistics",
                headUserId: headA.user.id,
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(preApproveComRes.status).toBe(409);
        expect(await preApproveComRes.json()).toMatchObject({
            error: { code: "EVENT_NOT_APPROVED" },
        });

        // REQUEST_REVISION requires feedbackNote -> 400 without, 200 with
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "REQUEST_REVISION",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(400);

        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "REQUEST_REVISION",
                        feedbackNote: "Please include estimated equipment checklist.",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(200);

        // Author updates & resubmits -> revisionCount increments to 1
        cookieJar.value = author.token;
        expect(
            (
                await eventByIdPatch(
                    makeJsonRequest(`/api/events/${eventId}`, "PATCH", {
                        descriptionHtml: "<p>Updated with full equipment checklist.</p>",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(200);
        const resubmitRes = await eventTransitionPost(
            makeJsonRequest(`/api/events/${eventId}/transition`, "POST", { action: "RESUBMIT" }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(resubmitRes.status).toBe(200);
        expect(
            ((await resubmitRes.json()) as { data: { event: { revisionCount: number } } }).data
                .event.revisionCount,
        ).toBe(1);

        // Executive approves -> APPROVED (still hidden from Member Portal calendar — AC-04!)
        cookieJar.value = executive.token;
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "APPROVE",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(200);

        cookieJar.value = member.token;
        const prePublishPortal = await portalCalendarGet();
        expect(prePublishPortal.status).toBe(200);
        const prePublishItems = (
            (await prePublishPortal.json()) as { data: { items: Array<{ id: string }> } }
        ).data.items;
        expect(prePublishItems.some((e) => e.id === eventId)).toBe(false);

        // AC-05: Assigning MEMBER as Committee Head is rejected (400 INVALID_COMMITTEE_HEAD)
        cookieJar.value = executive.token;
        const memberHeadRes = await committeesPost(
            makeJsonRequest(`/api/events/${eventId}/committees`, "POST", {
                name: "Logistics",
                headUserId: member.user.id,
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(memberHeadRes.status).toBe(400);
        expect(await memberHeadRes.json()).toMatchObject({
            error: { code: "INVALID_COMMITTEE_HEAD" },
        });

        // Executive creates Committee A (headA) and Committee B (headB); duplicate name -> 409
        const comARes = await committeesPost(
            makeJsonRequest(`/api/events/${eventId}/committees`, "POST", {
                name: "Logistics",
                headUserId: headA.user.id,
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(comARes.status).toBe(201);
        const comAId = (
            (await comARes.json()) as { data: { committee: { id: string } } }
        ).data.committee.id;

        const dupComRes = await committeesPost(
            makeJsonRequest(`/api/events/${eventId}/committees`, "POST", {
                name: "Logistics",
                headUserId: headB.user.id,
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(dupComRes.status).toBe(409);

        const comBRes = await committeesPost(
            makeJsonRequest(`/api/events/${eventId}/committees`, "POST", {
                name: "Technical",
                headUserId: headB.user.id,
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(comBRes.status).toBe(201);
        const comBId = (
            (await comBRes.json()) as { data: { committee: { id: string } } }
        ).data.committee.id;

        // SEC-TEST-03 & AC-05: headA manages Committee A roster, blocked (403) on Committee B
        cookieJar.value = headA.token;
        expect(
            (
                await committeeMemberPost(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "POST", {
                        userId: rosterOfficer.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(201);

        // Cannot add headA as member (400) or MEMBER as member (400) or duplicate (409)
        expect(
            (
                await committeeMemberPost(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "POST", {
                        userId: headA.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(400);
        expect(
            (
                await committeeMemberPost(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "POST", {
                        userId: member.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(400);
        expect(
            (
                await committeeMemberPost(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "POST", {
                        userId: rosterOfficer.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(409);

        // Cross-committee isolation -> 403 COMMITTEE_HEAD_REQUIRED
        const crossComRes = await committeeMemberPost(
            makeJsonRequest(`/api/events/${eventId}/committees/${comBId}/members`, "POST", {
                userId: rosterOfficer.user.id,
            }),
            { params: Promise.resolve({ id: eventId, committeeId: comBId }) },
        );
        expect(crossComRes.status).toBe(403);
        expect(await crossComRes.json()).toMatchObject({
            error: { code: "COMMITTEE_HEAD_REQUIRED" },
        });

        // Executive reassigns Committee A head to rosterOfficer -> removes rosterOfficer from members
        cookieJar.value = executive.token;
        const reassignRes = await committeePatch(
            makeJsonRequest(`/api/events/${eventId}/committees/${comAId}`, "PATCH", {
                headUserId: rosterOfficer.user.id,
            }),
            { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
        );
        expect(reassignRes.status).toBe(200);
        const reassigned = (
            (await reassignRes.json()) as {
                data: { committee: { head: { id: string }; members: Array<{ userId: string }> } };
            }
        ).data.committee;
        expect(reassigned.head.id).toBe(rosterOfficer.user.id);
        expect(reassigned.members.some((m) => m.userId === rosterOfficer.user.id)).toBe(false);

        // New head can add/remove headA on Committee A
        cookieJar.value = rosterOfficer.token;
        expect(
            (
                await committeeMemberPost(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "POST", {
                        userId: headA.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(201);
        expect(
            (
                await committeeMemberDelete(
                    makeJsonRequest(`/api/events/${eventId}/committees/${comAId}/members`, "DELETE", {
                        userId: headA.user.id,
                    }),
                    { params: Promise.resolve({ id: eventId, committeeId: comAId }) },
                )
            ).status,
        ).toBe(200);

        // PUBLISH fails without venue + publicSummary -> 400; succeeds with both -> visible on /api/portal/calendar
        cookieJar.value = executive.token;
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "PUBLISH",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(400);

        const pubRes = await eventTransitionPost(
            makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                action: "PUBLISH",
                venue: "HNU Innovation Center",
                publicSummary: "Join SYComP for a full-day student hackathon.",
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(pubRes.status).toBe(200);

        // AC-04: Now visible to MEMBER with public-only fields (no descriptionHtml leaked)
        cookieJar.value = member.token;
        const postPublishPortal = await portalCalendarGet();
        const portalItems = (
            (await postPublishPortal.json()) as {
                data: { items: Array<Record<string, unknown>> };
            }
        ).data.items;
        const publicRow = portalItems.find((e) => e.id === eventId);
        expect(publicRow).toBeDefined();
        expect(publicRow?.descriptionHtml).toBeUndefined();
        expect(publicRow?.publicSummary).toBe("Join SYComP for a full-day student hackathon.");

        // UNPUBLISH requires reason -> 400 without, 200 with -> hidden from portal again
        cookieJar.value = executive.token;
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "UNPUBLISH",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(400);
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "UNPUBLISH",
                        feedbackNote: "Rescheduling room reservation with university admin.",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(200);

        // Re-publish, insert OPEN checkpoint -> COMPLETE returns 409 OPEN_CHECKPOINTS_EXIST
        expect(
            (
                await eventTransitionPost(
                    makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                        action: "PUBLISH",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(200);

        const [openCp] = await conn.db
            .insert(attendanceCheckpoints)
            .values({
                eventId,
                label: "AM In",
                audienceScope: "ALL",
                status: "OPEN",
                sortOrder: 1,
                createdBy: executive.user.id,
            })
            .returning();

        const blockedCompleteRes = await eventTransitionPost(
            makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                action: "COMPLETE",
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(blockedCompleteRes.status).toBe(409);
        expect(await blockedCompleteRes.json()).toMatchObject({
            error: { code: "OPEN_CHECKPOINTS_EXIST" },
        });

        // Close checkpoint -> COMPLETE succeeds and locks further EXECUTIVE mutations (409 RESOURCE_LOCKED)
        await conn.db
            .update(attendanceCheckpoints)
            .set({ status: "CLOSED" })
            .where(eq(attendanceCheckpoints.id, openCp.id));

        const completeRes = await eventTransitionPost(
            makeJsonRequest(`/api/events/${eventId}/transition`, "POST", {
                action: "COMPLETE",
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(completeRes.status).toBe(200);

        expect(
            (
                await eventByIdPatch(
                    makeJsonRequest(`/api/events/${eventId}`, "PATCH", {
                        venue: "Post-Complete Mutation",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(409);

        // SEC-TEST-08: SUPER_ADMIN requires breakGlass + >=10 char reason on locked event
        cookieJar.value = superAdmin.token;
        expect(
            (
                await eventByIdPatch(
                    makeJsonRequest(`/api/events/${eventId}`, "PATCH", {
                        venue: "Missing BG",
                    }),
                    { params: Promise.resolve({ id: eventId }) },
                )
            ).status,
        ).toBe(400);

        const bgEditRes = await eventByIdPatch(
            makeJsonRequest(`/api/events/${eventId}`, "PATCH", {
                venue: "HNU Innovation Center (Verified)",
                breakGlass: true,
                reason: "Correcting archived venue spelling per post-event report.",
            }),
            { params: Promise.resolve({ id: eventId }) },
        );
        expect(bgEditRes.status).toBe(200);

        const [bgAudit] = await conn.db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "event"),
                    eq(auditLogs.entityId, eventId),
                    eq(auditLogs.action, "EVENT_UPDATED"),
                ),
            )
            .orderBy(desc(auditLogs.createdAt))
            .limit(1);
        expect((bgAudit.afterState as Record<string, unknown> | null)?.break_glass).toBe(true);
    });

    it("enforces CSRF Origin checks, CLOSED-term immutability, and escaped LIKE search", async () => {
        const executive = await createTestUser("EXECUTIVE", { withAppointment: true });
        const superAdmin = await createTestUser("SUPER_ADMIN");

        cookieJar.value = executive.token;

        // Missing Origin -> 403 CSRF_FORBIDDEN
        const csrfRes = await eventsPost(
            makeJsonRequest(
                "/api/events",
                "POST",
                {
                    title: "CSRF Blocked Event",
                    descriptionHtml: "<p>Body</p>",
                    startAt: "2026-11-15T08:00:00+08:00",
                    endAt: "2026-11-15T12:00:00+08:00",
                },
                { origin: null },
            ),
        );
        expect(csrfRes.status).toBe(403);
        expect(await csrfRes.json()).toMatchObject({ error: { code: "CSRF_FORBIDDEN" } });

        // CLOSED term event returns 409 RESOURCE_LOCKED for EXECUTIVE
        const closedCode = `EV-CLOSED-${randomUUID().slice(0, 6)}`;
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

        const wildcardQuery = `100%_Literal_${randomUUID().slice(0, 6)}`;
        const [closedEvent] = await conn.db
            .insert(events)
            .values({
                academicTermId: closedTerm.id,
                title: `${wildcardQuery}_Test`,
                slug: `wildcard-test-${randomUUID().slice(0, 6)}`,
                descriptionHtml: "<p>Historical</p>",
                startAt: new Date("2025-03-01T08:00:00+08:00"),
                endAt: new Date("2025-03-01T12:00:00+08:00"),
                status: "APPROVED",
                createdBy: executive.user.id,
            })
            .returning();

        expect(
            (
                await eventByIdPatch(
                    makeJsonRequest(`/api/events/${closedEvent.id}`, "PATCH", {
                        venue: "Blocked",
                    }),
                    { params: Promise.resolve({ id: closedEvent.id }) },
                )
            ).status,
        ).toBe(409);

        // Escaped LIKE query matches literal "100%_Literal_..." without matching unrelated rows
        const searchRes = await eventsGet(
            makeJsonRequest(
                `/api/events?q=${encodeURIComponent(wildcardQuery)}`,
                "GET",
            ),
        );
        expect(searchRes.status).toBe(200);
        const searchItems = (
            (await searchRes.json()) as { data: { items: Array<{ id: string }> } }
        ).data.items;
        expect(searchItems.map((e) => e.id)).toEqual([closedEvent.id]);
    });
});
