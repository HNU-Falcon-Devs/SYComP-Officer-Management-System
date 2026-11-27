import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "@/lib/security/sanitize";
import {
    ALLOWED_MEETING_TRANSITIONS,
    createMeetingSchema,
    isoToManilaDateTimeLocal,
    manilaDateTimeLocalToIso,
    meetingsListQuerySchema,
    updateMeetingMinutesSchema,
    updateMeetingSchema,
} from "./validation";

describe("Officer Meetings validation, state transitions, Manila helpers, and XSS hygiene", () => {
    it("validates createMeetingSchema and rejects end before start", () => {
        const valid = createMeetingSchema.safeParse({
            title: "1st General Officers Assembly",
            scheduledStartAt: "2026-10-18T09:00:00+08:00",
            scheduledEndAt: "2026-10-18T11:00:00+08:00",
            locationOrLink: "CCS Faculty Room",
            agendaHtml: "<p>Call to order</p>",
        });
        expect(valid.success).toBe(true);

        const invalidRange = createMeetingSchema.safeParse({
            title: "Invalid Window Meeting",
            scheduledStartAt: "2026-10-18T11:00:00+08:00",
            scheduledEndAt: "2026-10-18T09:00:00+08:00",
        });
        expect(invalidRange.success).toBe(false);
    });

    it("enforces updateMeetingSchema non-empty patch and strict keys", () => {
        expect(updateMeetingSchema.safeParse({}).success).toBe(false);
        expect(
            updateMeetingSchema.safeParse({ title: "Updated Title", unknownField: 1 }).success,
        ).toBe(false);
        expect(updateMeetingSchema.safeParse({ status: "ONGOING" }).success).toBe(true);
        expect(updateMeetingMinutesSchema.safeParse({ minutesHtml: "" }).success).toBe(true);
    });

    it("enforces the BR-MTG meeting status state machine", () => {
        expect(ALLOWED_MEETING_TRANSITIONS.SCHEDULED).toEqual(["ONGOING", "CANCELLED"]);
        expect(ALLOWED_MEETING_TRANSITIONS.ONGOING).toEqual(["COMPLETED"]);
        expect(ALLOWED_MEETING_TRANSITIONS.COMPLETED).toEqual([]);
        expect(ALLOWED_MEETING_TRANSITIONS.CANCELLED).toEqual([]);
    });

    it("converts Asia/Manila datetime-local strings cleanly and validates date filters", () => {
        const iso = manilaDateTimeLocalToIso("2026-10-18T09:30");
        expect(iso).toBe("2026-10-18T09:30:00+08:00");
        expect(isoToManilaDateTimeLocal("2026-10-18T01:30:00.000Z")).toBe("2026-10-18T09:30");
        expect(manilaDateTimeLocalToIso("not-a-date")).toBeNull();

        expect(
            meetingsListQuerySchema.safeParse({ from: "2026-10-18", to: "2026-10-17" }).success,
        ).toBe(false);
        expect(
            meetingsListQuerySchema.safeParse({ from: "2026-10-18", to: "2026-10-18" }).success,
        ).toBe(true);
    });

    it("strips XSS scripts, event handlers, and javascript: links via sanitizeRichText (SEC-TEST-06)", () => {
        const dirty =
            '<h2>Minutes</h2><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad</a> <a href="https://hnu.edu.ph">good</a>';
        const clean = sanitizeRichText(dirty);

        expect(clean).not.toContain("<script");
        expect(clean).not.toContain("onerror");
        expect(clean).not.toContain("<img");
        expect(clean).not.toContain("javascript:");
        expect(clean).toContain("<h2>Minutes</h2>");
        expect(clean).toContain('href="https://hnu.edu.ph"');
        expect(clean).toContain('rel="noopener noreferrer"');
    });
});
