import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Permission, SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { getDb, type DbExecutor } from "@/db";
import {
    authorize,
    AuthorizationError,
    createDrizzleAuthorizeDeps,
    type AuthorizeResourceContext,
} from "./authorize";
import { getSessionFromToken, SESSION_COOKIE_NAME, type ActiveSessionContext } from "./session";

const AUTH_PATHS = new Set<string>([
    ROUTES.auth.login,
    ROUTES.auth.forgotPassword,
    ROUTES.auth.accountHold,
]);

export function sanitizeNextPath(next: string | null | undefined): string | null {
    if (!next) {
        return null;
    }
    const trimmed = next.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
        return null;
    }
    const pathOnly = trimmed.split(/[?#]/)[0] ?? "";
    if (AUTH_PATHS.has(pathOnly)) {
        return null;
    }
    return trimmed;
}

export function getDefaultHomeForRole(role: SystemRole): string {
    return role === "MEMBER" ? ROUTES.portal.home : ROUTES.workspace.dashboard;
}

export function resolvePostLoginRedirect(role: SystemRole, next: string | null | undefined): string {
    const safeNext = sanitizeNextPath(next);
    if (!safeNext) {
        return getDefaultHomeForRole(role);
    }

    const isPortalPath = safeNext === ROUTES.portal.home || safeNext.startsWith(`${ROUTES.portal.home}/`);
    if (role === "MEMBER") {
        return isPortalPath ? safeNext : ROUTES.portal.home;
    }

    return isPortalPath ? ROUTES.workspace.dashboard : safeNext;
}

export function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) {
            return first.slice(0, 45);
        }
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    return realIp ? realIp.slice(0, 45) : "127.0.0.1";
}

export function assertSameOrigin(request: Request): void {
    const originHeader = request.headers.get("origin");
    const refererHeader = request.headers.get("referer");
    const candidate = originHeader || refererHeader;

    if (!candidate) {
        throw new AuthorizationError(
            403,
            "CSRF_FORBIDDEN",
            "Missing origin header on state-changing request.",
        );
    }

    let candidateOrigin: string;
    try {
        candidateOrigin = new URL(candidate).origin;
    } catch {
        throw new AuthorizationError(403, "CSRF_FORBIDDEN", "Invalid origin header.");
    }

    const allowedOrigins = new Set<string>();
    try {
        allowedOrigins.add(new URL(request.url).origin);
    } catch {
        // Ignore invalid request URL in synthetic contexts
    }

    if (process.env.APP_URL) {
        try {
            allowedOrigins.add(new URL(process.env.APP_URL).origin);
        } catch {
            // Ignore malformed APP_URL
        }
    }

    if (!allowedOrigins.has(candidateOrigin)) {
        throw new AuthorizationError(403, "CSRF_FORBIDDEN", "Cross-origin request rejected.");
    }
}

export async function getServerSession(
    executor?: DbExecutor,
): Promise<ActiveSessionContext | null> {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!rawToken) {
        return null;
    }

    return getSessionFromToken(executor ?? getDb(), rawToken);
}

export async function requireServerAuth(
    permission: Permission,
    resource: AuthorizeResourceContext = {},
) {
    const db = getDb();
    const session = await getServerSession(db);

    try {
        const authorized = await authorize(
            { actor: session?.user ?? null },
            permission,
            resource,
            createDrizzleAuthorizeDeps(db),
        );
        return {
            ...authorized,
            user: session!.user,
            sessionId: session!.sessionId,
        };
    } catch (error) {
        if (error instanceof AuthorizationError) {
            if (error.status === 401) {
                redirect(ROUTES.auth.login);
            }
            if (error.code === "ACCOUNT_HOLD") {
                redirect(ROUTES.auth.accountHold);
            }
            if (error.status === 403 && session?.user) {
                redirect(getDefaultHomeForRole(session.user.systemRole));
            }
        }
        throw error;
    }
}

export function apiJson<T>(data: T, status = 200, headers?: HeadersInit) {
    return NextResponse.json({ data }, { status, headers });
}

export function apiError(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    headers?: HeadersInit,
) {
    return NextResponse.json(
        {
            error: {
                code,
                message,
                ...(details ? { details } : {}),
            },
        },
        { status, headers },
    );
}

export function apiErrorResponse(error: unknown) {
    if (error instanceof AuthorizationError) {
        return apiError(error.status, error.code, error.message);
    }

    if (error instanceof ZodError) {
        return apiError(400, "VALIDATION_ERROR", "Invalid request input.", {
            issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        });
    }

    return apiError(500, "INTERNAL_ERROR", "An unexpected server error occurred.");
}
