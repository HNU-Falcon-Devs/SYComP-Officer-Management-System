import type { Env } from "@/config/env";
import { normalizeUniversityEmail } from "@/lib/auth/otp";
import { ConsoleEmailProvider } from "./console.provider";
import { ResendEmailProvider } from "./resend.provider";
import { SmtpEmailProvider } from "./smtp.provider";

export interface SendEmailInput {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export interface EmailProvider {
    send(input: SendEmailInput): Promise<{ messageId: string }>;
}

export function createDomainGuardedEmailProvider(
    provider: EmailProvider,
    universityDomain: string,
): EmailProvider {
    return {
        async send(input: SendEmailInput) {
            const normalizedTo = normalizeUniversityEmail(input.to, universityDomain);
            if (!normalizedTo) {
                throw new Error(
                    `Email recipient rejected: must belong to @${universityDomain.toLowerCase()}.`,
                );
            }
            return provider.send({ ...input, to: normalizedTo });
        },
    };
}

export function createEmailProvider(env: Env): EmailProvider {
    let rawProvider: EmailProvider;

    if (env.EMAIL_PROVIDER === "resend") {
        rawProvider = new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
    } else if (env.EMAIL_PROVIDER === "smtp") {
        rawProvider = new SmtpEmailProvider({
            host: env.SMTP_HOST!,
            port: env.SMTP_PORT!,
            user: env.SMTP_USER!,
            pass: env.SMTP_PASS!,
            from: env.EMAIL_FROM,
        });
    } else {
        rawProvider = new ConsoleEmailProvider(env.EMAIL_FROM);
    }

    return createDomainGuardedEmailProvider(rawProvider, env.UNIVERSITY_EMAIL_DOMAIN);
}
