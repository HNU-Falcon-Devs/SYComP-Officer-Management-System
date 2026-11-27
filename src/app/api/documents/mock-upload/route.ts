import { z } from "zod";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";
import { authorize, createDrizzleAuthorizeDeps } from "@/lib/auth/authorize";
import {
    apiError,
    apiErrorResponse,
    apiJson,
    assertSameOrigin,
    getServerSession,
} from "@/lib/auth/server";
import { DriveServiceError, getDriveProvider, getMockDriveProvider } from "@/lib/drive/adapter";

const sessionIdSchema = z.string().uuid("Invalid mock upload session ID.");

export async function PUT(request: Request) {
    try {
        if (process.env.NODE_ENV === "production") {
            return apiError(404, "MOCK_UPLOAD_DISABLED", "Mock upload endpoint is disabled.");
        }

        const env = getEnv();
        const provider = getDriveProvider(env);
        if (provider.mode !== "mock") {
            return apiError(404, "MOCK_UPLOAD_DISABLED", "Mock upload endpoint is disabled.");
        }

        assertSameOrigin(request);

        const db = getDb();
        const session = await getServerSession(db);
        const { actor } = await authorize(
            { actor: session?.user ?? null },
            "document:upload",
            {},
            createDrizzleAuthorizeDeps(db),
        );

        const url = new URL(request.url);
        const sessionId = sessionIdSchema.parse(url.searchParams.get("sessionId"));

        const bytes = new Uint8Array(await request.arrayBuffer());
        const mockProvider = getMockDriveProvider(provider.rootFolderId);
        const completed = mockProvider.completeMockUpload(sessionId, actor.id, {
            bytes,
            contentType: request.headers.get("content-type"),
        });

        return apiJson(completed, 200, { "Cache-Control": "no-store" });
    } catch (error) {
        if (error instanceof DriveServiceError) {
            return apiError(error.status, error.code, error.message);
        }
        return apiErrorResponse(error);
    }
}
