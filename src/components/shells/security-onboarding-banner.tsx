import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { SessionActorDto } from "@/lib/auth/dto";

interface SecurityOnboardingBannerProps {
    actor: SessionActorDto;
    accountHref: string;
}

export function SecurityOnboardingBanner({ actor, accountHref }: SecurityOnboardingBannerProps) {
    if (!actor.mustChangePassword && actor.emailVerified) {
        return null;
    }

    const actionsNeeded: string[] = [];
    if (!actor.emailVerified) {
        actionsNeeded.push("bind and verify your @hnu.edu.ph email");
    }
    if (actor.mustChangePassword) {
        actionsNeeded.push("replace your default password");
    }

    return (
        <div
            role="region"
            aria-label="Account security setup reminder"
            className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-foreground"
        >
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                <div className="flex items-center gap-2">
                    <ShieldAlert
                        className="size-4 shrink-0 text-warning"
                        strokeWidth={1.75}
                        aria-hidden="true"
                    />
                    <span>
                        Security setup incomplete: please {actionsNeeded.join(" and ")}.
                    </span>
                </div>
                <Link
                    href={accountHref}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-warning/30 bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                    <span>Complete setup</span>
                    <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                </Link>
            </div>
        </div>
    );
}
