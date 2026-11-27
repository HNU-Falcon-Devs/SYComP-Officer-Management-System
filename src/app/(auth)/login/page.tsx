import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getServerSession, resolvePostLoginRedirect, sanitizeNextPath } from "@/lib/auth/server";

async function LoginGate({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    const params = await searchParams;
    const safeNext = sanitizeNextPath(params.next);
    const session = await getServerSession();

    // Only redirect off /login when PostgreSQL validates an ACTIVE session
    if (session && session.user.accountStatus === "ACTIVE") {
        redirect(resolvePostLoginRedirect(session.user.systemRole, safeNext));
    }

    return <LoginForm nextPath={safeNext} />;
}

export default function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    return (
        <Suspense fallback={<Skeleton className="h-96 w-full max-w-md rounded-lg" />}>
            <LoginGate searchParams={searchParams} />
        </Suspense>
    );
}
