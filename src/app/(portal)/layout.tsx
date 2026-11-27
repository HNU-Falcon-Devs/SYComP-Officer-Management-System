import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { requireServerAuth } from "@/lib/auth/server";
import { ShellA } from "@/components/shells/shell-a";
import { Skeleton } from "@/components/ui/skeleton";

async function PortalAuthGuard({ children }: { children: ReactNode }) {
    const { actor } = await requireServerAuth("event:public:view");

    if (actor.systemRole !== "MEMBER") {
        redirect(ROUTES.workspace.dashboard);
    }

    return <ShellA actor={actor}>{children}</ShellA>;
}

export default function PortalLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense
            fallback={
                <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-48 w-full" />
                </div>
            }
        >
            <PortalAuthGuard>{children}</PortalAuthGuard>
        </Suspense>
    );
}
