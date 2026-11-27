import { describe, expect, it } from "vitest";
import {
    hashPassword,
    normalizeDefaultPassword,
    validateUserPasswordPolicy,
    verifyPassword,
    verifyPasswordOrDummy,
} from "./password";

describe("password primitives", () => {
    it("normalizes default passwords per BR-ACCT-01", () => {
        expect(normalizeDefaultPassword("De La Cruz", "2024-01234")).toBe("delacruz2024-01234");
        expect(normalizeDefaultPassword("O'Connor-Sánchez", " 2025-0099 ")).toBe(
            "oconnorsanchez2025-0099",
        );
    });

    it("hashes and verifies passwords with versioned scrypt format", async () => {
        const hash = await hashPassword("delacruz2024-01234");
        expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
        await expect(verifyPassword("delacruz2024-01234", hash)).resolves.toBe(true);
        await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
        await expect(verifyPasswordOrDummy("any-password", null)).resolves.toBe(false);
    });

    it("enforces user-set password policy", () => {
        expect(validateUserPasswordPolicy("short1", "2024-01234", "De La Cruz").valid).toBe(false);
        expect(validateUserPasswordPolicy("onlylettersonly", "2024-01234", "De La Cruz").valid).toBe(
            false,
        );
        expect(validateUserPasswordPolicy("2024-01234", "2024-01234", "De La Cruz").valid).toBe(
            false,
        );
        expect(
            validateUserPasswordPolicy("delacruz2024-01234", "2024-01234", "De La Cruz").valid,
        ).toBe(false);
        expect(
            validateUserPasswordPolicy("Str0ngPass!2026", "2024-01234", "De La Cruz").valid,
        ).toBe(true);
    });
});
