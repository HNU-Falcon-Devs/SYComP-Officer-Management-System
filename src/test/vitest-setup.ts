import { vi } from "vitest";

vi.mock("server-only", () => ({}));

if (process.env.SKIP_DOTENV !== "1") {
    try {
        process.loadEnvFile?.();
    } catch {
        // Ignore when .env does not exist (e.g., DB-less CI)
    }
}
