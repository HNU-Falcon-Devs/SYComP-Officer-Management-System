import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { meetings } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getClientIp,
    getServerSession,
} from "@/lib/auth/server";
import { loadMeetingDetailById, sanitizeNullableRichText } from "../../_lib/queries";
import { updateMeetingMinutesSchema } from "../../_lib/validation";

const uuidSchema = z.string().uuid("Invalid meeting ID.");

export async function PATCH(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { id } = await context.params;
        const meetingId = uuidSchema.parse(id);

        const body = await request.json().catch(() => null);
        const input = updateMeetingMinutesSchema.parse(body);

        const loaded = await loadMeetingDetailById(db, meetingId);
        if (!loaded) {
            await authorize(
                { actor: session?.user ?? null, breakGlass: input.breakGlass, reason: input.reason },
                "meeting:minutes:edit",
                {},
                createDrizzleAuthorizeDeps(db),
            );
            return apiError(404, "MEETING_NOT_FOUND", "Officer meeting not found.");
        }

        const { actor, isBreakGlass, reason } = await authorize(
            {
                actor: session?.user ?? null,
                breakGlass: input.breakGlass,
                reason: input.reason,
            },
            "meeting:minutes:edit",
            {
                termStatus: loaded.termStatus,
                meetingStatus: loaded.raw.status,
                academicTermId: loaded.raw.academicTermId,
            },
            createDrizzleAuthorizeDeps(db),
        );

        const sanitizedMinutes = sanitizeNullableRichText(input.minutesHtml);
        const now = new Date();
        const ip = getClientIp(request);

        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({
                    id: meetings.id,
                    minutesHtml: meetings.minutesHtml,
                })
                .from(meetings)
                .where(eq(meetings.id, meetingId))
                .limit(1);

            if (!existing) {
                return;
            }

            await tx
                .update(meetings)
                .set({
                    minutesHtml: sanitizedMinutes,
                    updatedAt: now,
                })
                .where(eq(meetings.id, existing.id));

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "MEETING_MINUTES_UPDATED",
                entityType: "meeting",
                entityId: existing.id,
                beforeState: {
                    hasMinutes: Boolean(existing.minutesHtml),
                    minutesLength: existing.minutesHtml?.length ?? 0,
                },
                afterState: {
                    hasMinutes: Boolean(sanitizedMinutes),
                    minutesLength: sanitizedMinutes?.length ?? 0,
                },
                reason: isBreakGlass ? reason : input.reason?.trim() || null,
                ipAddress: ip,
                breakGlass: isBreakGlass,
            });
        });

        const refreshed = await loadMeetingDetailById(db, meetingId);
        return apiJson(
            { meeting: refreshed?.dto ?? loaded.dto },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
