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

const httpUrlSchema = z
    .string()
    .trim()
    .pipe(
        z.url({
            protocol: /^https?$/,
            error: "Must be a valid http:// or https:// URL",
        }),
    );

const optionalNonEmptyString = z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().trim().min(1).optional(),
);

export const envSchema = z
    .object({
        // Supabase PostgreSQL (Drizzle / postgres-js)
        DATABASE_URL: postgresUrlSchema,
        DIRECT_DATABASE_URL: postgresUrlSchema,

        // App & Security
        APP_URL: httpUrlSchema.default("http://localhost:3000"),
        UNIVERSITY_EMAIL_DOMAIN: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Must be a valid university domain (e.g. hnu.edu.ph)"),
        OTP_HMAC_SECRET: z.string().trim().min(32, "Must be at least 32 characters"),
        UPLOAD_INTENT_SECRET: z.string().trim().min(32, "Must be at least 32 characters"),

        // Google Drive API v3 (OAuth2 Refresh Token)
        GOOGLE_DRIVE_CLIENT_ID: z.string().trim().min(1, "Required"),
        GOOGLE_DRIVE_CLIENT_SECRET: z.string().trim().min(1, "Required"),
        GOOGLE_DRIVE_REFRESH_TOKEN: z.string().trim().min(1, "Required"),
        GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().trim().min(1, "Required"),
        DRIVE_SHARE_MODE: z.enum(["domain", "unlisted"]).default("domain"),
        MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(15_728_640),

        // Transactional Email Adapter
        EMAIL_PROVIDER: z.enum(["console", "resend", "smtp"]).default("console"),
        EMAIL_FROM: z.string().trim().min(1).default("SYComP OMS <no-reply@sycomp.local>"),
        RESEND_API_KEY: optionalNonEmptyString,
        SMTP_HOST: optionalNonEmptyString,
        SMTP_PORT: z.preprocess(
            (val) => (val === "" || val === undefined ? undefined : val),
            z.coerce.number().int().positive().optional(),
        ),
        SMTP_USER: optionalNonEmptyString,
        SMTP_PASS: optionalNonEmptyString,
    })
    .superRefine((data, ctx) => {
        if (data.EMAIL_PROVIDER === "resend" && !data.RESEND_API_KEY) {
            ctx.addIssue({
                code: "custom",
                path: ["RESEND_API_KEY"],
                message: "Required when EMAIL_PROVIDER is 'resend'",
            });
        }
        if (data.EMAIL_PROVIDER === "smtp") {
            const requiredSmtp = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"] as const;
            for (const key of requiredSmtp) {
                if (!data[key]) {
                    ctx.addIssue({
                        code: "custom",
                        path: [key],
                        message: "Required when EMAIL_PROVIDER is 'smtp'",
                    });
                }
            }
        }
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

export function resetEnvCache(): void {
    cachedEnv = undefined;
}
