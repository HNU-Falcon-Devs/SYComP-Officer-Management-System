import { z } from "zod";

const postgresUrlSchema = z
    .string()
    .trim()
    .pipe(
        z.url({
            protocol: /^postgres(ql)?$/,
            error: "Must be a valid PostgreSQL connection URL (postgres:// or postgresql://)",
        }),
    );

export const envSchema = z.object({
    // Supabase PostgreSQL (Drizzle / postgres-js)
    DATABASE_URL: postgresUrlSchema,
    DIRECT_DATABASE_URL: postgresUrlSchema,

    // Google Drive API v3 (OAuth2 Refresh Token)
    GOOGLE_DRIVE_CLIENT_ID: z.string().trim().min(1, "Required"),
    GOOGLE_DRIVE_CLIENT_SECRET: z.string().trim().min(1, "Required"),
    GOOGLE_DRIVE_REFRESH_TOKEN: z.string().trim().min(1, "Required"),
    GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().trim().min(1, "Required"),
    DRIVE_SHARE_MODE: z.enum(["domain", "unlisted"]).default("domain"),
    MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(15_728_640),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
    const parsed = envSchema.safeParse(source);

    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
            .join("\n");

        throw new Error(`Invalid or missing environment variables:\n${issues}`);
    }

    return parsed.data;
}

let cachedEnv: Env | undefined;

export function getEnv(): Env {
    if (!cachedEnv) {
        cachedEnv = parseEnv(process.env);
    }

    return cachedEnv;
}
