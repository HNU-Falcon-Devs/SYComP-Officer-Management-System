import { and, desc, eq } from "drizzle-orm";
import { Megaphone, Pin } from "lucide-react";
import { getDb } from "@/db";
import { announcements } from "@/db/schema";
import { requireServerAuth } from "@/lib/auth/server";
import { sanitizeRichText } from "@/lib/security/sanitize";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PortalAnnouncementsPage() {
    await requireServerAuth("announcement:public:view");
    const db = getDb();

    const rows = await db
        .select({
            id: announcements.id,
            title: announcements.title,
            bodyHtml: announcements.bodyHtml,
            isPinned: announcements.isPinned,
            publishedAt: announcements.publishedAt,
        })
        .from(announcements)
        .where(
            and(eq(announcements.status, "PUBLISHED"), eq(announcements.audience, "ALL_MEMBERS")),
        )
        .orderBy(desc(announcements.isPinned), desc(announcements.publishedAt));

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Official SYComP notices for computing students.
                </p>
            </div>

            {rows.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Megaphone
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="text-sm text-muted-foreground">
                            No published announcements at this time.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="flex flex-col gap-4">
                    {rows.map((item) => (
                        <Card key={item.id}>
                            <CardHeader className="flex flex-row items-start justify-between gap-3">
                                <div>
                                    <CardTitle>{item.title}</CardTitle>
                                    {item.publishedAt ? (
                                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                                            {item.publishedAt.toISOString().slice(0, 10)}
                                        </p>
                                    ) : null}
                                </div>
                                {item.isPinned ? (
                                    <Badge variant="brand">
                                        <Pin className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                        Pinned
                                    </Badge>
                                ) : null}
                            </CardHeader>
                            <CardContent>
                                <div
                                    className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground"
                                    dangerouslySetInnerHTML={{
                                        __html: sanitizeRichText(item.bodyHtml),
                                    }}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
