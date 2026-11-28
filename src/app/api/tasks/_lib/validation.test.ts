import { describe, expect, it } from "vitest";
import {
    createTaskSchema,
    isPgForeignKeyViolation,
    isReviewerOnlyStatusTransition,
    isTaskOverdue,
    parseTasksSearchParams,
    tasksListQuerySchema,
    updateTaskSchema,
} from "./validation";

describe("Tasks validation and transition helpers", () => {
    it("enforces committeeId requires eventId and rejects unknown fields on createTaskSchema", () => {
        const validCommittee = createTaskSchema.safeParse({
            title: "Prepare audio setup",
            eventId: "11111111-2222-4333-8444-555555555555",
            committeeId: "22222222-3333-4444-8555-666666666666",
            priority: "HIGH",
            dueAt: "2026-11-20T15:00:00+08:00",
        });
        expect(validCommittee.success).toBe(true);

        const validGeneral = createTaskSchema.safeParse({
            title: "Update semester org budget sheet",
            priority: "MEDIUM",
        });
        expect(validGeneral.success).toBe(true);

        const committeeWithoutEvent = createTaskSchema.safeParse({
            title: "Orphan committee task",
            committeeId: "22222222-3333-4444-8555-666666666666",
        });
        expect(committeeWithoutEvent.success).toBe(false);

        const extraField = createTaskSchema.safeParse({
            title: "Bad extra field",
            status: "DONE",
        });
        expect(extraField.success).toBe(false);
    });

    it("requires at least one mutable field on updateTaskSchema", () => {
        expect(updateTaskSchema.safeParse({}).success).toBe(false);
        expect(updateTaskSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
        expect(updateTaskSchema.safeParse({ dueAt: null }).success).toBe(true);
    });

    it("classifies reviewer-only status transitions strictly per BR-TSK-02", () => {
        expect(isReviewerOnlyStatusTransition("TO_DO", "IN_PROGRESS")).toBe(false);
        expect(isReviewerOnlyStatusTransition("IN_PROGRESS", "TO_DO")).toBe(false);
        expect(isReviewerOnlyStatusTransition("IN_PROGRESS", "FOR_REVIEW")).toBe(false);
        expect(isReviewerOnlyStatusTransition("TO_DO", "FOR_REVIEW")).toBe(false);

        expect(isReviewerOnlyStatusTransition("FOR_REVIEW", "DONE")).toBe(true);
        expect(isReviewerOnlyStatusTransition("IN_PROGRESS", "DONE")).toBe(true);
        expect(isReviewerOnlyStatusTransition("FOR_REVIEW", "IN_PROGRESS")).toBe(true);
        expect(isReviewerOnlyStatusTransition("FOR_REVIEW", "TO_DO")).toBe(true);
        expect(isReviewerOnlyStatusTransition("DONE", "IN_PROGRESS")).toBe(true);
    });

    it("evaluates overdue status and Postgres FK error unwrapping accurately", () => {
        const now = Date.parse("2026-11-20T12:00:00Z");
        expect(isTaskOverdue("IN_PROGRESS", "2026-11-20T11:59:00Z", now)).toBe(true);
        expect(isTaskOverdue("DONE", "2026-11-20T11:59:00Z", now)).toBe(false);
        expect(isTaskOverdue("TO_DO", "2026-11-20T12:01:00Z", now)).toBe(false);
        expect(isTaskOverdue("TO_DO", null, now)).toBe(false);

        expect(isPgForeignKeyViolation({ code: "23503" })).toBe(true);
        expect(isPgForeignKeyViolation({ cause: { code: "23503" } })).toBe(true);
        expect(isPgForeignKeyViolation({ code: "23505" })).toBe(false);
    });

    it("parses and validates tasks list query params including due date range", () => {
        const parsed = tasksListQuerySchema.safeParse(
            parseTasksSearchParams(
                new URLSearchParams(
                    "scope=mine&status=IN_PROGRESS&priority=URGENT&overdueOnly=true&dueFrom=2026-11-01&dueTo=2026-11-30",
                ),
            ),
        );
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.scope).toBe("mine");
            expect(parsed.data.overdueOnly).toBe(true);
        }

        const badRange = tasksListQuerySchema.safeParse(
            parseTasksSearchParams(new URLSearchParams("dueFrom=2026-11-30&dueTo=2026-11-01")),
        );
        expect(badRange.success).toBe(false);
    });
});
