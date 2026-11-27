import { getDb } from "@/db";
import {
    attendanceRecordsListQuerySchema,
    parseAttendanceSearchParams,
    queryAttendanceRecordsList,
} from "@/lib/attendance/validation";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "attendance:export",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const parsed = attendanceRecordsListQuerySchema.parse(
            parseAttendanceSearchParams(url.searchParams),
        );

        const { items, total } = await queryAttendanceRecordsList(db, parsed, {
            page: parsed.page,
            limit: parsed.limit,
            includeActors: true,
        });

        return apiJson(
            {
                items,
                pagination: {
                    page: parsed.page,
                    limit: parsed.limit,
                    total,
                },
            },
            200,
            { "Cache-Control": "no-store" },
        );
    } catch (error) {
        return apiErrorResponse(error);
    }
}
