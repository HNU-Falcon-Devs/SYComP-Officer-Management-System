import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { toSafeUserDto } from "@/lib/auth/dto";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import { revokeAllUserSessions } from "@/lib/auth/session";

const uuidSchema = z.string().uuid("Invalid user ID.");

const adminResetSchema = z.object({
    reason: z.string().trim().min(5, "A reason of at least 5 characters is required.").max(500),
});

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "user:password:admin_reset",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const { id } = await context.params;
        const targetUserId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = adminResetSchema.parse(body);

        const [target] = await db
            .select()
            .from(users)
            .where(eq(users.id, targetUserId))
            .limit(1);

        if (!target) {
            return apiError(404, "USER_NOT_FOUND", "Target user not found.");
        }

        const nextHash = await hashPassword(
            normalizeDefaultPassword(target.lastName, target.studentIdNumber),
        );
        const now = new Date();
        const ip = getClientIp(request);

        const updated = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(users)
                .set({
                    passwordHash: nextHash,
                    mustChangePassword: true,
                    updatedAt: now,
                })
                .where(eq(users.id, target.id))
                .returning();

            await revokeAllUserSessions(tx, target.id, now);

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "USER_PASSWORD_ADMIN_RESET",
                entityType: "user",
                entityId: target.id,
                beforeState: { mustChangePassword: target.mustChangePassword },
                afterState: { mustChangePassword: true },
                reason: input.reason,
                ipAddress: ip,
            });

            return row;
        });

        return apiJson({ user: toSafeUserDto(updated) });
    } catch (error) {
        return apiErrorResponse(error);
    }
}
