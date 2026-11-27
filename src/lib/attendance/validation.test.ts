import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    attendanceRecordsFilterSchema,
    createCheckpointSchema,
    manualOverrideCreateSchema,
    manualOverridePatchSchema,
    studentIdNumberSchema,
    updateCheckpointSchema,
} from "./validation";

describe("M3A attendance validation schemas", () => {
    it("validates institutional Student ID QR payloads", () => {
        expect(studentIdNumberSchema.parse("  2024-01234  ")).toBe("2024-01234");
        expect(studentIdNumberSchema.parse("ADMIN-0001")).toBe("ADMIN-0001");

        for (const bad of ["", "https://evil.test/?id=1", "2024 01234", "<script>", "a"]) {
            expect(() => studentIdNumberSchema.parse(bad)).toThrow();
        }
    });

    it("enforces checkpoint parent XOR, time window, and strict PATCH rules", () => {
        const eventId = randomUUID();
        const meetingId = randomUUID();

        expect(
            createCheckpointSchema.parse({
                eventId,
                label: "AM In",
                audienceScope: "GENERAL_MEMBERS",
                sortOrder: 1,
                opensAt: "2026-10-18T00:00:00Z",
                closesAt: "2026-10-18T04:00:00Z",
            }).label,
        ).toBe("AM In");

        expect(() => createCheckpointSchema.parse({ label: "Orphan" })).toThrow();
        expect(() =>
            createCheckpointSchema.parse({ eventId, meetingId, label: "Both" }),
        ).toThrow();
        expect(() =>
            createCheckpointSchema.parse({
                eventId,
                label: "Bad Window",
                opensAt: "2026-10-18T08:00:00Z",
                closesAt: "2026-10-18T04:00:00Z",
            }),
        ).toThrow();

        expect(() => updateCheckpointSchema.parse({})).toThrow();
        expect(() =>
            updateCheckpointSchema.parse({ status: "OPEN", extraField: "nope" }),
        ).toThrow();
        expect(updateCheckpointSchema.parse({ status: "OPEN" }).status).toBe("OPEN");
    });

    it("enforces mandatory override editReason and attendance filter parent scope", () => {
        const checkpointId = randomUUID();
        const recordId = randomUUID();

        expect(() =>
            manualOverrideCreateSchema.parse({
                checkpointId,
                studentIdNumber: "2024-01234",
                status: "PRESENT",
                editReason: "ok",
            }),
        ).toThrow();
        expect(() =>
            manualOverridePatchSchema.parse({
                recordId,
                status: "EXCUSED",
                editReason: "   ",
            }),
        ).toThrow();

        expect(() => attendanceRecordsFilterSchema.parse({ q: "2024" })).toThrow();
        expect(() =>
            attendanceRecordsFilterSchema.parse({
                checkpointId,
                from: "2026-11-28",
                to: "2026-11-27",
            }),
        ).toThrow();
        expect(
            attendanceRecordsFilterSchema.parse({
                checkpointId,
                from: "2026-11-27",
                to: "2026-11-27",
            }).from,
        ).toBe("2026-11-27");
    });
});
