import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "@/db";
import { redactAuditState, writeAuditLog } from "./audit";

describe("audit logger & credential redaction", () => {
    it("recursively strips credential keys before storing audit snapshots", () => {
        const redacted = redactAuditState({
            studentIdNumber: "2024-00001",
            password_hash: "scrypt$secret",
            passwordHash: "scrypt$secret",
            tokenHash: "sha256$secret",
            nested: {
                otpSecret: "top-secret",
                cookieValue: "session=xyz",
                status: "ACTIVE",
            },
        });

        expect(redacted).toEqual({
            studentIdNumber: "2024-00001",
            nested: {
                status: "ACTIVE",
            },
        });
    });

    it("tags break_glass: true and validates mandatory break-glass reason", async () => {
        const returning = vi.fn().mockResolvedValue([{ id: "audit-1" }]);
        const values = vi.fn().mockReturnValue({ returning });
        const insert = vi.fn().mockReturnValue({ values });
        const fakeTx = { insert } as unknown as DbExecutor;

        await expect(
            writeAuditLog(fakeTx, {
                actorId: "sa-1",
                action: "CHECKPOINT_STATE_CHANGED",
                entityType: "attendance_checkpoint",
                entityId: "cp-1",
                breakGlass: true,
                reason: "short",
            }),
        ).rejects.toThrow(/10 characters/);

        await writeAuditLog(fakeTx, {
            actorId: "sa-1",
            action: "CHECKPOINT_STATE_CHANGED",
            entityType: "attendance_checkpoint",
            entityId: "cp-1",
            beforeState: { status: "SCHEDULED", token_hash: "hidden" },
            afterState: { status: "OPEN", passwordHash: "hidden" },
            breakGlass: true,
            reason: "Emergency live checkpoint opening approved by VP Internal.",
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                beforeState: { status: "SCHEDULED" },
                afterState: { status: "OPEN", break_glass: true },
                reason: "Emergency live checkpoint opening approved by VP Internal.",
            }),
        );
    });
});
