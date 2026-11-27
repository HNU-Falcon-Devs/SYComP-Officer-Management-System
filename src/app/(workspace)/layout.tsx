import { Suspense, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { academicTerms } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { ShellB } from "@/components/shells/shell-b";
import { Skeleton } from "@/components/ui/skeleton";

async function WorkspaceAuthGuard({ children }: { children: ReactNode }) {
    const { actor } = await requireServerAuth("event:workspace:view");
    const db = getDb();

    const [activeTerm] = await db
        .select({ code: academicTerms.code, name: academicTerms.name })
        .from(academicTerms)
        .where(eq(academicTerms.status, "ACTIVE"))
        .limit(1);

    return (
        <ShellB actor={actor} activeTerm={activeTerm ?? null}>
            {children}
        </ShellB>
    );
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen bg-background">
                    <Skeleton className="hidden h-screen w-[248px] rounded-none lg:block" />
                    <div className="flex flex-1 flex-col gap-4 p-6">
                        <Skeleton className="h-14 w-full" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                </div>
            }
        >
            <WorkspaceAuthGuard>{children}</WorkspaceAuthGuard>
        </Suspense>
    );
}
