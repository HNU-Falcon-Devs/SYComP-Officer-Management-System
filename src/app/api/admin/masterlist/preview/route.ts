import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms } from "@/db/schema";
import {
    buildMasterlistPreview,
    MasterlistParseError,
    MAX_MASTERLIST_BYTES,
    parseMasterlistBuffer,
} from "@/lib/admin/masterlist";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getServerSession,
} from "@/lib/auth/server";

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "masterlist:import",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const [activeTerm] = await db
            .select({ id: academicTerms.id, code: academicTerms.code })
            .from(academicTerms)
            .where(eq(academicTerms.status, "ACTIVE"))
            .limit(1);

        if (!activeTerm) {
            return apiError(
                409,
                "NO_ACTIVE_TERM",
                "An ACTIVE academic term is required before importing a masterlist.",
            );
        }

        const formData = await request.formData().catch(() => null);
        const file = formData?.get("file");
        if (!(file instanceof File)) {
            return apiError(400, "MISSING_FILE", "Upload a .csv or .xlsx masterlist file.");
        }

        if (file.size > MAX_MASTERLIST_BYTES) {
            return apiError(400, "FILE_TOO_LARGE", "Masterlist file exceeds the 5 MB limit.");
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const rawRows = await parseMasterlistBuffer(buffer, file.name);
        const preview = await buildMasterlistPreview(db, rawRows, file.name);

        return apiJson({
            activeTerm,
            preview,
            parsedRows: rawRows,
        });
    } catch (error) {
        if (error instanceof MasterlistParseError) {
            return apiError(error.status, error.code, error.message);
        }
        return apiErrorResponse(error);
    }
}
