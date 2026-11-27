import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import { apiErrorResponse, apiJson, getServerSession } from "@/lib/auth/server";
import { loadDocumentMetadataOptions, queryDocumentsList } from "@/lib/drive/queries";
import { documentsListQuerySchema, parseDocumentsSearchParams } from "@/lib/drive/validation";

export async function GET(request: Request) {
    try {
        const db = getDb();
        const session = await getServerSession(db);
        await authorize(
            { actor: session?.user ?? null },
            "document:view",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const query = documentsListQuerySchema.parse(parseDocumentsSearchParams(url.searchParams));

        const { items, total } = await queryDocumentsList(db, query);

        if (query.includeMeta === "true") {
            const env = getEnv();
            const meta = await loadDocumentMetadataOptions(db, query.eventId);
            return apiJson(
                {
                    items,
                    pagination: {
                        page: query.page,
                        limit: query.limit,
                        total,
                    },
                    meta: {
                        ...meta,
                        driveShareMode: env.DRIVE_SHARE_MODE,
                        maxUploadSizeBytes: env.MAX_UPLOAD_SIZE_BYTES,
                    },
                },
                200,
                { "Cache-Control": "no-store" },
            );
        }

        return apiJson(
            {
                items,
                pagination: {
                    page: query.page,
                    limit: query.limit,
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
