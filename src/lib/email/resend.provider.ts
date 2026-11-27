import type { EmailProvider, SendEmailInput } from "./adapter";

export class ResendEmailProvider implements EmailProvider {
    constructor(
        private readonly apiKey: string,
        private readonly from: string,
    ) {}

    async send(input: SendEmailInput): Promise<{ messageId: string }> {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: this.from,
                to: [input.to],
                subject: input.subject,
                html: input.html,
                text: input.text,
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Resend API error (${response.status}): ${detail}`);
        }

        const payload = (await response.json()) as { id?: string };
        return { messageId: payload.id ?? "resend-unknown" };
    }
}
