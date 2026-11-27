import { describe, expect, it } from "vitest";
import { evaluateProxyRequest } from "./proxy";

describe("Next.js 16 proxy route preflight", () => {
    it("redirects unauthenticated requests on protected routes to /login with sanitized next path", () => {
        expect(evaluateProxyRequest("/portal", "", false)).toEqual({
            action: "redirect",
            location: "/login?next=%2Fportal",
        });

        expect(evaluateProxyRequest("/dashboard", "?tab=overview", false)).toEqual({
            action: "redirect",
            location: "/login?next=%2Fdashboard%3Ftab%3Doverview",
        });

        expect(evaluateProxyRequest("/meetings/123", "", false)).toEqual({
            action: "redirect",
            location: "/login?next=%2Fmeetings%2F123",
        });
    });

    it("rejects protocol-relative or backslash open redirects in next param", () => {
        expect(evaluateProxyRequest("//evil.example.com", "", false)).toEqual({
            action: "next",
        });
        expect(evaluateProxyRequest("/portal", "", false)).toEqual({
            action: "redirect",
            location: "/login?next=%2Fportal",
        });
    });

    it("allows /login, /forgot-password, and /account-hold even when a stale session cookie exists", () => {
        expect(evaluateProxyRequest("/login", "", true)).toEqual({ action: "next" });
        expect(evaluateProxyRequest("/forgot-password", "", true)).toEqual({ action: "next" });
        expect(evaluateProxyRequest("/account-hold", "", true)).toEqual({ action: "next" });
    });

    it("allows protected routes through when session cookie is present (server authorize verifies DB)", () => {
        expect(evaluateProxyRequest("/portal/attendance", "", true)).toEqual({ action: "next" });
        expect(evaluateProxyRequest("/dashboard", "", true)).toEqual({ action: "next" });
    });
});
