import { defineConfig } from "drizzle-kit";

try {
    process.loadEnvFile?.();
} catch {
    // Allow drizzle-kit generate without a local .env
}

export default defineConfig({
    schema: "./src/db/schema/index.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DIRECT_DATABASE_URL ?? "",
    },
    strict: true,
    verbose: true,
});
