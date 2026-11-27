import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { getDefaultHomeForRole, getServerSession } from "@/lib/auth/server";
import { Skeleton } from "@/components/ui/skeleton";

async function RootRouter(): Promise<never> {
    const session = await getServerSession();
    if (!session) {
        redirect(ROUTES.auth.login);
    }
    if (session.user.accountStatus !== "ACTIVE") {
        redirect(ROUTES.auth.accountHold);
    }
    redirect(getDefaultHomeForRole(session.user.systemRole));
}

export default function HomePage() {
    return (
        <Suspense
            fallback={
                <main className="flex min-h-screen items-center justify-center p-6">
                    <Skeleton className="h-10 w-48" />
                </main>
            }
        >
            <RootRouter />
        </Suspense>
    );
}
