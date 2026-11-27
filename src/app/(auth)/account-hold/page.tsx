import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { ROUTES } from "@/config/routes";
import { getDefaultHomeForRole, getServerSession } from "@/lib/auth/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

async function AccountHoldGate() {
    const session = await getServerSession();

    // Only redirect away if server DB confirms an ACTIVE session
    if (session && session.user.accountStatus === "ACTIVE") {
        redirect(getDefaultHomeForRole(session.user.systemRole));
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <div className="flex items-center gap-2.5">
                    <ShieldOff className="size-6 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
                    <h1 className="text-2xl font-semibold tracking-tight">Account on hold</h1>
                </div>
                <CardDescription>
                    Your SYComP OMS account is currently marked as disabled or pending masterlist
                    verification.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <div className="rounded-md border border-border bg-muted p-3.5 text-sm leading-relaxed text-foreground">
                    If you are currently enrolled in BSIT or BSCS at Holy Name University, contact
                    SYComP officers or the Technical Director (`SUPER_ADMIN`) with your Student ID to
                    restore your account status.
                </div>
                <Link href={ROUTES.auth.login} className={buttonVariants({ variant: "secondary" })}>
                    <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    <span>Return to sign in</span>
                </Link>
            </CardContent>
        </Card>
    );
}

export default function AccountHoldPage() {
    return (
        <Suspense fallback={<Skeleton className="h-72 w-full max-w-md rounded-lg" />}>
            <AccountHoldGate />
        </Suspense>
    );
}
