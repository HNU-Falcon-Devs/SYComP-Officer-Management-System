import { randomUUID } from "node:crypto";
import type { EmailProvider, SendEmailInput } from "./adapter";

export class ConsoleEmailProvider implements EmailProvider {
    constructor(private readonly from: string) {}

    async send(input: SendEmailInput): Promise<{ messageId: string }> {
        const messageId = `console-${randomUUID()}`;
        if (process.env.NODE_ENV !== "test") {
            console.info(`[EMAIL:${messageId}] from=${this.from} to=${input.to} subject="${input.subject}"`);
        }
        return { messageId };
    }
}
