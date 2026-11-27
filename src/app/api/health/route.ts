import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { apiError, apiJson } from "@/lib/auth/server";

export async function GET() {
    try {
        await getDb().execute(sql`SELECT 1`);
        return apiJson({ status: "ok", timestamp: new Date().toISOString() });
    } catch {
        return apiError(503, "DB_UNAVAILABLE", "Database health check failed.");
    }
}
