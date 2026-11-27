import { describe, expect, it } from "vitest";
import {
    generateOtpCode,
    hashOtpCode,
    normalizeUniversityEmail,
    verifyOtpHash,
} from "./otp";

describe("OTP and institutional domain primitives", () => {
    const secret = "test-hmac-secret-at-least-32-chars-long";

    it("generates 6-digit numeric OTPs and verifies HMAC-SHA256 digests", () => {
        const code = generateOtpCode();
        expect(code).toMatch(/^\d{6}$/);

        const digest = hashOtpCode(code, secret);
        expect(verifyOtpHash(code, digest, secret)).toBe(true);
        expect(verifyOtpHash("000000", digest, secret)).toBe(code === "000000");
        expect(verifyOtpHash(code, "not-hex", secret)).toBe(false);
    });

    it("enforces exact UNIVERSITY_EMAIL_DOMAIN matching (SEC-TEST-07)", () => {
        expect(normalizeUniversityEmail("  Student.Name@HNU.EDU.PH ", "hnu.edu.ph")).toBe(
            "student.name@hnu.edu.ph",
        );
        expect(normalizeUniversityEmail("student@gmail.com", "hnu.edu.ph")).toBeNull();
        expect(normalizeUniversityEmail("student@sub.hnu.edu.ph", "hnu.edu.ph")).toBeNull();
        expect(normalizeUniversityEmail("student@hnu.edu.ph.evil.com", "hnu.edu.ph")).toBeNull();
    });
});
