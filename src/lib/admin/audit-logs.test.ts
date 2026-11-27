import { describe, expect, it } from "vitest";
import {
    auditLogsFilterSchema,
    computeStateDiff,
    escapeLikePattern,
    formatManilaTimestamp,
    isValidCalendarDate,
    manilaDayStartUtc,
    manilaNextDayStartUtc,
    toAuditLogDto,
} from "./audit-logs";

describe("audit-logs helpers", () => {
    it("validates calendar dates and computes exact Asia/Manila UTC bounds", () => {
        expect(isValidCalendarDate("2026-11-27")).toBe(true);
        expect(isValidCalendarDate("2026-02-31")).toBe(false);
        expect(isValidCalendarDate("2026-13-01")).toBe(false);
        expect(isValidCalendarDate("not-a-date")).toBe(false);

        expect(manilaDayStartUtc("2026-11-27").toISOString()).toBe("2026-11-26T16:00:00.000Z");
        expect(manilaNextDayStartUtc("2026-11-27").toISOString()).toBe("2026-11-27T16:00:00.000Z");

        expect(formatManilaTimestamp("2026-11-26T16:00:00.000Z")).toBe("2026-11-27 00:00:00 PHT");
        expect(formatManilaTimestamp("2026-11-27T15:59:59.000Z")).toBe("2026-11-27 23:59:59 PHT");
    });

    it("rejects reversed from/to ranges and invalid calendar dates in Zod schema", () => {
        expect(() =>
            auditLogsFilterSchema.parse({ from: "2026-11-28", to: "2026-11-27" }),
        ).toThrow();
        expect(() => auditLogsFilterSchema.parse({ from: "2026-02-30" })).toThrow();

        const valid = auditLogsFilterSchema.parse({
            from: "2026-11-27",
            to: "2026-11-27",
            breakGlassOnly: "true",
        });
        expect(valid.breakGlassOnly).toBe(true);
        expect(valid.from).toBe("2026-11-27");
        expect(valid.to).toBe("2026-11-27");
    });

    it("escapes LIKE wildcards cleanly", () => {
        expect(escapeLikePattern("100%_test\\path")).toBe("100\\%\\_test\\\\path");
    });

    it("performs defense-in-depth redaction and computes break-glass & state diffs", () => {
        const dto = toAuditLogDto({
            id: "audit-1",
            createdAt: new Date("2026-11-27T08:00:00.000Z"),
            action: "OFFICER_APPOINTED",
            entityType: "officer_appointment",
            entityId: "entity-1",
            reason: "Closed term correction approved by board.",
            ipAddress: "127.0.0.1",
            beforeState: {
                status: "ACTIVE",
                password_hash: "scrypt$leaked",
            },
            afterState: {
                status: "DISABLED",
                tokenHash: "deadbeef",
                nested: { otpSecret: "secret-val", note: "ok" },
                break_glass: true,
            },
            actorId: null,
            actorStudentIdNumber: null,
            actorFullName: null,
            actorSystemRole: null,
        });

        expect(dto.actor).toBeNull();
        expect(dto.isBreakGlass).toBe(true);
        expect(dto.beforeState).toEqual({ status: "ACTIVE" });
        expect(dto.afterState).toEqual({
            status: "DISABLED",
            nested: { note: "ok" },
            break_glass: true,
        });

        const diff = computeStateDiff(
            { a: 1, b: "old", c: "removed" },
            { a: 1, b: "new", d: "added" },
        );
        expect(diff).toEqual([
            { key: "a", kind: "unchanged", before: 1, after: 1 },
            { key: "b", kind: "changed", before: "old", after: "new" },
            { key: "c", kind: "removed", before: "removed", after: undefined },
            { key: "d", kind: "added", before: undefined, after: "added" },
        ]);
    });
});
