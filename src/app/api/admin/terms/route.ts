import { count, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { academicTerms, officerAppointments } from "@/db/schema";
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

const createTermSchema = z
    .object({
        code: z
            .string()
            .trim()
            .min(2)
            .max(40)
            .regex(/^[A-Za-z0-9-]+$/, "Term code must contain only letters, numbers, and hyphens."),
        name: z.string().trim().min(3).max(120),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format."),
    })
    .refine((data) => data.endDate >= data.startDate, {
        message: "End date must be on or after start date.",
        path: ["endDate"],
    });

export async function GET() {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "term:history:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const terms = await db
            .select()
            .from(academicTerms)
            .orderBy(desc(academicTerms.startDate), desc(academicTerms.createdAt));

        const apptCounts = await db
            .select({
                academicTermId: officerAppointments.academicTermId,
                total: count(),
            })
            .from(officerAppointments)
            .groupBy(officerAppointments.academicTermId);

        const countByTerm = new Map(apptCounts.map((c) => [c.academicTermId, Number(c.total)]));

        return apiJson({
            terms: terms.map((t) => ({
                id: t.id,
                code: t.code,
                name: t.name,
                startDate: t.startDate,
                endDate: t.endDate,
                status: t.status,
                activatedAt: t.activatedAt ? t.activatedAt.toISOString() : null,
                closedAt: t.closedAt ? t.closedAt.toISOString() : null,
                createdAt: t.createdAt.toISOString(),
                appointmentCount: countByTerm.get(t.id) ?? 0,
            })),
        });
    } catch (error) {
        return apiErrorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "term:manage",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const body = await request.json().catch(() => null);
        const input = createTermSchema.parse(body);
        const normalizedCode = input.code.toUpperCase();
        const ip = getClientIp(request);

        const created = await db.transaction(async (tx) => {
            const [term] = await tx
                .insert(academicTerms)
                .values({
                    code: normalizedCode,
                    name: input.name,
                    startDate: input.startDate,
                    endDate: input.endDate,
                    status: "DRAFT",
                    createdBy: actor.id,
                })
                .returning();

            await writeAuditLog(tx, {
                actorId: actor.id,
                action: "TERM_CREATED",
                entityType: "academic_term",
                entityId: term.id,
                afterState: {
                    code: term.code,
                    name: term.name,
                    startDate: term.startDate,
                    endDate: term.endDate,
                    status: term.status,
                },
                ipAddress: ip,
            });

            return term;
        });

        return apiJson(
            {
                term: {
                    id: created.id,
                    code: created.code,
                    name: created.name,
                    startDate: created.startDate,
                    endDate: created.endDate,
                    status: created.status,
                    activatedAt: null,
                    closedAt: null,
                    createdAt: created.createdAt.toISOString(),
                    appointmentCount: 0,
                },
            },
            201,
        );
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            return apiError(409, "TERM_CONFLICT", "A term with that code or name already exists.");
        }
        return apiErrorResponse(error);
    }
}
