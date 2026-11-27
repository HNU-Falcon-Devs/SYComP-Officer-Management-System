import { describe, expect, it } from "vitest";
import {
    buildSystemSettingsSummary,
    createDocumentTypeSchema,
    formatDrivePathPreview,
    isPgUniqueViolation,
    isValidDriveFolderSegment,
    slugifyDocumentTypeName,
    updateDocumentTypeSchema,
} from "./settings";

describe("settings & document_types helpers", () => {
    it("normalizes slugs and rejects unsafe Drive folder segments", () => {
        expect(slugifyDocumentTypeName("Financial & Audit Reports!")).toBe(
            "financial-audit-reports",
        );

        expect(isValidDriveFolderSegment("Financial Reports")).toBe(true);
        expect(isValidDriveFolderSegment("Post-Event Reports (2026)")).toBe(true);

        for (const bad of [
            "a/b",
            "a\\b",
            "a|b",
            ".",
            "..",
            "../secret",
            "foo..bar",
            ".hidden",
            "trailing.",
            "bad\x07char",
            "bad\nline",
        ]) {
            expect(isValidDriveFolderSegment(bad)).toBe(false);
        }
    });

    it("enforces strict schemas on create and update (immutable slug)", () => {
        const created = createDocumentTypeSchema.parse({
            name: "Certificates",
            slug: "",
            driveFolderSegment: "Certificates",
        });
        expect(created.slug).toBeUndefined();

        expect(() =>
            createDocumentTypeSchema.parse({
                name: "Bad",
                driveFolderSegment: "bad|folder",
            }),
        ).toThrow();

        expect(() => updateDocumentTypeSchema.parse({})).toThrow();
        expect(() =>
            updateDocumentTypeSchema.parse({
                slug: "mutated-slug",
                name: "Renamed",
            }),
        ).toThrow();

        const validPatch = updateDocumentTypeSchema.parse({
            name: "Updated Name",
            isActive: false,
        });
        expect(validPatch.isActive).toBe(false);
    });

    it("detects PostgreSQL 23505 unique violations across direct and Drizzle-wrapped errors", () => {
        expect(isPgUniqueViolation({ code: "23505" })).toBe(true);
        expect(isPgUniqueViolation({ cause: { code: "23505" } })).toBe(true);
        expect(isPgUniqueViolation({ code: "22P02" })).toBe(false);
        expect(isPgUniqueViolation(null)).toBe(false);
    });

    it("builds allowlisted system settings summary with zero secrets and safe fallbacks", () => {
        const secrets = {
            DATABASE_URL: "postgres://user:supersecretpass@db.local:6543/app",
            DIRECT_DATABASE_URL: "postgres://user:directsecret@db.local:5432/app",
            APP_URL: "https://oms.sycomp.org",
            UNIVERSITY_EMAIL_DOMAIN: "HNU.EDU.PH",
            OTP_HMAC_SECRET: "otp-secret-value-at-least-32-characters-long",
            UPLOAD_INTENT_SECRET: "upload-intent-secret-at-least-32-chars-long",
            GOOGLE_DRIVE_CLIENT_ID: "drive-client-id-secret",
            GOOGLE_DRIVE_CLIENT_SECRET: "drive-client-secret-value",
            GOOGLE_DRIVE_REFRESH_TOKEN: "drive-refresh-token-value",
            GOOGLE_DRIVE_ROOT_FOLDER_ID: "drive-root-folder-id-secret",
            DRIVE_SHARE_MODE: "domain",
            MAX_UPLOAD_SIZE_BYTES: "15728640",
            EMAIL_PROVIDER: "resend",
            EMAIL_FROM: "SYComP <no-reply@oms.sycomp.org>",
            RESEND_API_KEY: "re_secret_api_key_12345",
            SMTP_PASS: "smtp-password-secret",
        };

        const summary = buildSystemSettingsSummary(secrets);
        const serialized = JSON.stringify(summary);

        expect(summary.runtime.universityEmailDomain).toBe("hnu.edu.ph");
        expect(summary.integrations).toEqual({
            databaseConnected: true,
            driveConfigured: true,
            emailTransportConfigured: true,
            otpSecretConfigured: true,
            uploadIntentSecretConfigured: true,
        });

        for (const leaked of [
            secrets.DATABASE_URL,
            secrets.DIRECT_DATABASE_URL,
            secrets.OTP_HMAC_SECRET,
            secrets.UPLOAD_INTENT_SECRET,
            secrets.GOOGLE_DRIVE_CLIENT_ID,
            secrets.GOOGLE_DRIVE_CLIENT_SECRET,
            secrets.GOOGLE_DRIVE_REFRESH_TOKEN,
            secrets.GOOGLE_DRIVE_ROOT_FOLDER_ID,
            secrets.RESEND_API_KEY,
            secrets.SMTP_PASS,
        ]) {
            expect(serialized).not.toContain(leaked);
        }

        const emptySummary = buildSystemSettingsSummary({});
        expect(emptySummary.integrations).toEqual({
            databaseConnected: true,
            driveConfigured: false,
            emailTransportConfigured: true,
            otpSecretConfigured: false,
            uploadIntentSecretConfigured: false,
        });

        expect(formatDrivePathPreview("AY 2026-2027 - 1st Sem", "Financial Reports")).toBe(
            "AY 2026-2027 - 1st Sem / Financial Reports / General",
        );
    });
});
