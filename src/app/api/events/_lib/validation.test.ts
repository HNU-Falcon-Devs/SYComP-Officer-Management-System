import { describe, expect, it } from "vitest";
import {
    ALLOWED_EVENT_TRANSITIONS,
    createCommitteeSchema,
    createEventSchema,
    eventsListQuerySchema,
    isUuidString,
    parseEventsSearchParams,
    slugifyEventTitle,
    stripHtmlToPlainText,
    transitionEventSchema,
    updateEventSchema,
} from "./validation";

describe("Events & Committees validation helpers", () => {
    it("generates clean URL-safe slugs and strips HTML to plain text", () => {
        expect(slugifyEventTitle("Tech Innovation Summit 2026!!")).toBe(
            "tech-innovation-summit-2026",
        );
        expect(slugifyEventTitle("   ")).toBe("event-proposal");
        expect(stripHtmlToPlainText("<p>Hello <strong>SYComP</strong>&nbsp;World</p>")).toBe(
            "Hello SYComP World",
        );
        expect(isUuidString("11111111-2222-4333-8444-555555555555")).toBe(true);
        expect(isUuidString("tech-innovation-summit-2026")).toBe(false);
    });

    it("enforces createEventSchema date range, title length, and strict payload keys", () => {
        const valid = createEventSchema.safeParse({
            title: "Annual General Assembly",
            descriptionHtml: "<p>Agenda and overview</p>",
            startAt: "2026-10-18T08:00:00+08:00",
            endAt: "2026-10-18T17:00:00+08:00",
            venue: "HNU Barder Hall",
        });
        expect(valid.success).toBe(true);

        const reversedDates = createEventSchema.safeParse({
            title: "Invalid Range Event",
            descriptionHtml: "<p>Body</p>",
            startAt: "2026-10-18T17:00:00+08:00",
            endAt: "2026-10-18T08:00:00+08:00",
        });
        expect(reversedDates.success).toBe(false);

        const extraKey = createEventSchema.safeParse({
            title: "Extra Field",
            descriptionHtml: "<p>Body</p>",
            startAt: "2026-10-18T08:00:00+08:00",
            endAt: "2026-10-18T10:00:00+08:00",
            status: "PUBLISHED",
        });
        expect(extraKey.success).toBe(false);
    });

    it("requires at least one mutable field on updateEventSchema", () => {
        expect(updateEventSchema.safeParse({}).success).toBe(false);
        expect(updateEventSchema.safeParse({ venue: "Room 301" }).success).toBe(true);
    });

    it("validates event list query filters and date ordering", () => {
        const parsed = eventsListQuerySchema.safeParse(
            parseEventsSearchParams(
                new URLSearchParams("view=proposals&q=summit&from=2026-10-01&to=2026-10-31&page=2"),
            ),
        );
        expect(parsed.success).toBe(true);

        const badRange = eventsListQuerySchema.safeParse(
            parseEventsSearchParams(new URLSearchParams("from=2026-10-31&to=2026-10-01")),
        );
        expect(badRange.success).toBe(false);
    });

    it("validates transition actions, transition graph, and committee inputs", () => {
        expect(ALLOWED_EVENT_TRANSITIONS.SUBMIT).toEqual({ from: ["DRAFT"], to: "PENDING_REVIEW" });
        expect(ALLOWED_EVENT_TRANSITIONS.PUBLISH).toEqual({ from: ["APPROVED"], to: "PUBLISHED" });
        expect(ALLOWED_EVENT_TRANSITIONS.COMPLETE).toEqual({
            from: ["PUBLISHED"],
            to: "COMPLETED",
        });

        expect(transitionEventSchema.safeParse({ action: "APPROVE" }).success).toBe(true);
        expect(transitionEventSchema.safeParse({ action: "INVALID" }).success).toBe(false);

        expect(
            createCommitteeSchema.safeParse({
                name: "Technical Committee",
                headUserId: "11111111-2222-4333-8444-555555555555",
            }).success,
        ).toBe(true);
        expect(
            createCommitteeSchema.safeParse({
                name: "X",
                headUserId: "not-a-uuid",
            }).success,
        ).toBe(false);
    });
});
