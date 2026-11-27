import { NextResponse, type NextRequest } from "next/server";
import { ROUTES } from "@/config/routes";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

const PROTECTED_PREFIXES = [
    ROUTES.portal.home,
    ROUTES.workspace.dashboard,
    ROUTES.workspace.account,
    ROUTES.workspace.scanner,
    ROUTES.workspace.events,
    ROUTES.workspace.tasks,
    ROUTES.workspace.meetings,
    ROUTES.workspace.documents,
    ROUTES.workspace.announcements,
    ROUTES.workspace.directory,
    "/admin",
] as const;

export function isProtectedAppPath(pathname: string): boolean {
    return PROTECTED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export function sanitizeProxyNext(pathname: string, search: string): string | null {
    const combined = `${pathname}${search}`;
    if (!combined.startsWith("/") || combined.startsWith("//") || combined.startsWith("/\\")) {
        return null;
    }
    return combined;
}

export type ProxyDecision =
    | { action: "next" }
    | { action: "redirect"; location: string };

export function evaluateProxyRequest(
    pathname: string,
    search: string,
    hasSessionCookie: boolean,
): ProxyDecision {
    // Never redirect /login, /forgot-password, or /account-hold based on cookie presence alone.
    if (!isProtectedAppPath(pathname)) {
        return { action: "next" };
    }

    if (!hasSessionCookie) {
        const nextPath = sanitizeProxyNext(pathname, search);
        const loginTarget = nextPath
            ? `${ROUTES.auth.login}?next=${encodeURIComponent(nextPath)}`
            : ROUTES.auth.login;
        return { action: "redirect", location: loginTarget };
    }

    return { action: "next" };
}

export function proxy(request: NextRequest) {
    const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim());
    const decision = evaluateProxyRequest(
        request.nextUrl.pathname,
        request.nextUrl.search,
        hasSessionCookie,
    );

    if (decision.action === "redirect") {
        return NextResponse.redirect(new URL(decision.location, request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
