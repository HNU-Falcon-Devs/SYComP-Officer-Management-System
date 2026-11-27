import { cookies } from "next/headers";
import { getDb } from "@/db";
import { apiErrorResponse, apiJson, assertSameOrigin } from "@/lib/auth/server";
import { revokeSessionByToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const cookieStore = await cookies();
        const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
        if (rawToken) {
            await revokeSessionByToken(getDb(), rawToken);
        }

        const response = apiJson({ loggedOut: true });
        response.cookies.set(SESSION_COOKIE_NAME, "", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            expires: new Date(0),
        });

        return response;
    } catch (error) {
        return apiErrorResponse(error);
    }
}
