import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

describe("M0 harness smoke test", () => {
    it("resolves @/* alias and merges Tailwind classes via cn()", () => {
        expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    });

    it("parses valid Supabase and Google Drive environment variables with defaults", () => {
        const env = parseEnv({
            DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:6543/postgres",
            DIRECT_DATABASE_URL: "postgresql://postgres:secret@db.supabase.co:5432/postgres",
            GOOGLE_DRIVE_CLIENT_ID: "client-id.apps.googleusercontent.com",
            GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
            GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token",
            GOOGLE_DRIVE_ROOT_FOLDER_ID: "root-folder-id",
        });

        expect(env.DRIVE_SHARE_MODE).toBe("domain");
        expect(env.MAX_UPLOAD_SIZE_BYTES).toBe(15_728_640);
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
