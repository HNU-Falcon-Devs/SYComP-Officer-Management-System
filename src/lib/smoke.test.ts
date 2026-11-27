import { describe, expect, it } from "vitest";
import { parseEnv } from "@/config/env";
import { cn } from "@/lib/utils";

const baseEnv = {
    DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:6543/postgres",
    DIRECT_DATABASE_URL: "postgresql://postgres:secret@db.supabase.co:5432/postgres",
    UNIVERSITY_EMAIL_DOMAIN: "hnu.edu.ph",
    OTP_HMAC_SECRET: "a".repeat(32),
    UPLOAD_INTENT_SECRET: "b".repeat(32),
    GOOGLE_DRIVE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token",
    GOOGLE_DRIVE_ROOT_FOLDER_ID: "root-folder-id",
};

describe("M0/M1 harness & env smoke test", () => {
    it("resolves @/* alias and merges Tailwind classes via cn()", () => {
        expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    });

    it("parses valid Supabase, security, email, and Google Drive environment variables with defaults", () => {
        const env = parseEnv(baseEnv);

        expect(env.APP_URL).toBe("http://localhost:3000");
        expect(env.DRIVE_SHARE_MODE).toBe("domain");
        expect(env.MAX_UPLOAD_SIZE_BYTES).toBe(15_728_640);
        expect(env.EMAIL_PROVIDER).toBe("console");
    });

    it("requires provider credentials when EMAIL_PROVIDER is resend or smtp", () => {
        expect(() => parseEnv({ ...baseEnv, EMAIL_PROVIDER: "resend" })).toThrowError(/RESEND_API_KEY/);
        expect(() => parseEnv({ ...baseEnv, EMAIL_PROVIDER: "smtp" })).toThrowError(/SMTP_HOST[\s\S]*SMTP_PORT/);
    });

    it("fails fast on missing or invalid environment variables without leaking secret values", () => {
        const leakedSecret = "super-secret-token-value-12345";

        expect(() =>
            parseEnv({
                DATABASE_URL: "https://not-postgres.example.com",
                GOOGLE_DRIVE_CLIENT_SECRET: leakedSecret,
            }),
        ).toThrowError(/DATABASE_URL[\s\S]*DIRECT_DATABASE_URL[\s\S]*GOOGLE_DRIVE_CLIENT_ID/);

        try {
            parseEnv({
                DATABASE_URL: "https://not-postgres.example.com",
                GOOGLE_DRIVE_CLIENT_SECRET: leakedSecret,
            });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).not.toContain(leakedSecret);
        }
    });
});
