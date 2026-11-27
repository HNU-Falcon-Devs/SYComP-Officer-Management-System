import nodemailer, { type Transporter } from "nodemailer";
import type { EmailProvider, SendEmailInput } from "./adapter";

export interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
}

export class SmtpEmailProvider implements EmailProvider {
    private readonly transporter: Transporter;

    constructor(private readonly config: SmtpConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            auth: {
                user: config.user,
                pass: config.pass,
            },
        });
    }

    async send(input: SendEmailInput): Promise<{ messageId: string }> {
        const info = await this.transporter.sendMail({
            from: this.config.from,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
        });

        return { messageId: info.messageId };
    }
}
