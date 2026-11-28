import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireServerAuth } from "@/lib/auth/server";
import {
    loadEligibleOfficersForTerm,
    loadEventCommittees,
    loadEventDetailByIdOrSlug,
    loadEventProposalReviews,
} from "@/app/api/events/_lib/queries";
import { EventHubWorkspace } from "@/components/event-hub/event-hub-workspace";
import { Skeleton } from "@/components/ui/skeleton";

interface EventDetailPageProps {
    params: Promise<{ slug: string }>;
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
    const { actor } = await requireServerAuth("event:workspace:view");
    const { slug } = await params;

    const db = getDb();
    const loaded = await loadEventDetailByIdOrSlug(db, slug);
    if (!loaded) {
        notFound();
    }

    if (loaded.raw.status === "DRAFT") {
        await requireServerAuth("event:draft:view", {
            ownerUserId: loaded.raw.createdBy,
            eventId: loaded.raw.id,
            academicTermId: loaded.raw.academicTermId,
        });
    }

    const [reviews, committees, eligibleOfficers] = await Promise.all([
        loadEventProposalReviews(db, loaded.raw.id),
        loadEventCommittees(db, loaded.raw.id, loaded.raw.academicTermId),
        loadEligibleOfficersForTerm(db, loaded.raw.academicTermId),
    ]);

    return (
        <Suspense
            fallback={
                <div className="flex flex-col gap-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-72 w-full" />
                </div>
            }
        >
            <EventHubWorkspace
                actorId={actor.id}
                userRole={actor.systemRole}
                initialEvent={loaded.dto}
                initialReviews={reviews}
                initialCommittees={committees}
                eligibleOfficers={eligibleOfficers}
            />
        </Suspense>
    );
}
