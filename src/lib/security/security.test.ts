import { describe, expect, it, vi } from "vitest";
import { createDomainGuardedEmailProvider } from "@/lib/email/adapter";
import { formatCsvRow, neutralizeCsvCell } from "./csv-safe";
import { sanitizeRichText } from "./sanitize";

describe("security helpers (XSS, CSV, Email Domain)", () => {
    it("strips script tags, event handlers, and javascript: URIs (SEC-TEST-06)", () => {
        const dirty =
            '<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><a href="https://hnu.edu.ph" target="_blank">good</a>';
        const clean = sanitizeRichText(dirty);

        expect(clean).not.toContain("<script");
        expect(clean).not.toContain("onerror");
        expect(clean).not.toContain("javascript:");
        expect(clean).not.toContain("<img");
        expect(clean).toContain('href="https://hnu.edu.ph"');
        expect(clean).toContain('rel="noopener noreferrer"');
    });

    it("neutralizes spreadsheet formula prefixes in CSV cells", () => {
        expect(neutralizeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
        expect(neutralizeCsvCell("+1+1")).toBe("'+1+1");
        expect(neutralizeCsvCell("-1+1")).toBe("'-1+1");
        expect(neutralizeCsvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
        expect(formatCsvRow(["2024-00001", "Reyes, Elena", "=HYPERLINK()"])).toBe(
            '2024-00001,"Reyes, Elena",\'=HYPERLINK()',
        );
    });

    it("rejects non-university email recipients before invoking provider", async () => {
        const inner = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };
        const guarded = createDomainGuardedEmailProvider(inner, "hnu.edu.ph");

        await expect(
            guarded.send({
                to: "attacker@gmail.com",
                subject: "OTP",
                html: "<p>123456</p>",
                text: "123456",
            }),
        ).rejects.toThrow(/@hnu\.edu\.ph/);
        expect(inner.send).not.toHaveBeenCalled();

        await guarded.send({
            to: " Student@HNU.EDU.PH ",
            subject: "OTP",
            html: "<p>123456</p>",
            text: "123456",
        });
        expect(inner.send).toHaveBeenCalledWith(
            expect.objectContaining({ to: "student@hnu.edu.ph" }),
        );
    });
});
