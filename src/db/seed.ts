import { eq } from "drizzle-orm";
import { createDb } from "./index";
import {
    academicTerms,
    documentTypes,
    officerAppointments,
    users,
} from "./schema";
import { hashPassword, normalizeDefaultPassword } from "@/lib/auth/password";

try {
    process.loadEnvFile?.();
} catch {
    // Allow running with pre-populated environment variables
}

const DEFAULT_DOCUMENT_TYPES = [
    {
        name: "Communication Letters",
        slug: "communication-letters",
        driveFolderSegment: "Communication Letters",
    },
    {
        name: "Proposals",
        slug: "proposals",
        driveFolderSegment: "Proposals",
    },
    {
        name: "Minutes",
        slug: "minutes",
        driveFolderSegment: "Minutes",
    },
    {
        name: "Post-Event Reports",
        slug: "post-event-reports",
        driveFolderSegment: "Post-Event Reports",
    },
] as const;

export async function seedDatabase(connectionUrl: string): Promise<void> {
    const { db, client } = createDb(connectionUrl, { max: 1 });
    const now = new Date();

    try {
        await db.transaction(async (tx) => {
            const adminPasswordHash = await hashPassword(
                normalizeDefaultPassword("Adviser", "ADMIN-0001"),
            );

            await tx
                .insert(users)
                .values({
                    studentIdNumber: "ADMIN-0001",
                    firstName: "SYComP",
                    lastName: "Adviser",
                    fullName: "SYComP Faculty Adviser",
                    passwordHash: adminPasswordHash,
                    mustChangePassword: true,
                    systemRole: "SUPER_ADMIN",
                    accountStatus: "ACTIVE",
                })
                .onConflictDoNothing({ target: users.studentIdNumber });

            const [superAdmin] = await tx
                .select({ id: users.id })
                .from(users)
                .where(eq(users.studentIdNumber, "ADMIN-0001"))
                .limit(1);

            if (!superAdmin) {
                throw new Error("Failed to resolve seeded SUPER_ADMIN account.");
            }

            let [activeTerm] = await tx
                .select({ id: academicTerms.id })
                .from(academicTerms)
                .where(eq(academicTerms.status, "ACTIVE"))
                .limit(1);

            if (!activeTerm) {
                await tx
                    .insert(academicTerms)
                    .values({
                        code: "AY2026-2027-S1",
                        name: "AY 2026-2027 - 1st Sem",
                        startDate: "2026-08-01",
                        endDate: "2026-12-20",
                        status: "ACTIVE",
                        activatedAt: now,
                        createdBy: superAdmin.id,
                    })
                    .onConflictDoNothing({ target: academicTerms.code });

                [activeTerm] = await tx
                    .select({ id: academicTerms.id })
                    .from(academicTerms)
                    .where(eq(academicTerms.code, "AY2026-2027-S1"))
                    .limit(1);
            }

            for (const docType of DEFAULT_DOCUMENT_TYPES) {
                await tx
                    .insert(documentTypes)
                    .values({
                        name: docType.name,
                        slug: docType.slug,
                        driveFolderSegment: docType.driveFolderSegment,
                        isActive: true,
                        createdBy: superAdmin.id,
                    })
                    .onConflictDoNothing({ target: documentTypes.slug });
            }

            if (process.env.NODE_ENV !== "production" && activeTerm) {
                const sampleUsers = [
                    {
                        studentIdNumber: "2024-00001",
                        firstName: "Elena",
                        lastName: "Reyes",
                        fullName: "Elena Reyes",
                        systemRole: "EXECUTIVE" as const,
                        accountStatus: "ACTIVE" as const,
                        positionTitle: "President",
                        grantedSystemRole: "EXECUTIVE" as const,
                    },
                    {
                        studentIdNumber: "2024-00002",
                        firstName: "Marco",
                        lastName: "Santos",
                        fullName: "Marco Santos",
                        systemRole: "OFFICER" as const,
                        accountStatus: "ACTIVE" as const,
                        positionTitle: "Logistics Officer",
                        grantedSystemRole: "OFFICER" as const,
                    },
                    {
                        studentIdNumber: "2024-00003",
                        firstName: "Clara",
                        lastName: "De La Cruz",
                        fullName: "Clara De La Cruz",
                        systemRole: "MEMBER" as const,
                        accountStatus: "ACTIVE" as const,
                        positionTitle: null,
                        grantedSystemRole: null,
                    },
                    {
                        studentIdNumber: "2024-00004",
                        firstName: "Luis",
                        lastName: "Garcia",
                        fullName: "Luis Garcia",
                        systemRole: "MEMBER" as const,
                        accountStatus: "DISABLED" as const,
                        statusReason: "GRADUATED",
                        disabledAt: now,
                        disabledBy: superAdmin.id,
                        positionTitle: null,
                        grantedSystemRole: null,
                    },
                ];

                for (const sample of sampleUsers) {
                    const passwordHash = await hashPassword(
                        normalizeDefaultPassword(sample.lastName, sample.studentIdNumber),
                    );

                    await tx
                        .insert(users)
                        .values({
                            studentIdNumber: sample.studentIdNumber,
                            firstName: sample.firstName,
                            lastName: sample.lastName,
                            fullName: sample.fullName,
                            passwordHash,
                            mustChangePassword: true,
                            systemRole: sample.systemRole,
                            accountStatus: sample.accountStatus,
                            statusReason: sample.statusReason ?? null,
                            disabledAt: sample.disabledAt ?? null,
                            disabledBy: sample.disabledBy ?? null,
                        })
                        .onConflictDoNothing({ target: users.studentIdNumber });

                    if (sample.positionTitle && sample.grantedSystemRole) {
                        const [userRow] = await tx
                            .select({ id: users.id })
                            .from(users)
                            .where(eq(users.studentIdNumber, sample.studentIdNumber))
                            .limit(1);

                        if (userRow) {
                            await tx
                                .insert(officerAppointments)
                                .values({
                                    userId: userRow.id,
                                    academicTermId: activeTerm.id,
                                    positionTitle: sample.positionTitle,
                                    grantedSystemRole: sample.grantedSystemRole,
                                    isCurrent: true,
                                    appointedBy: superAdmin.id,
                                })
                                .onConflictDoNothing();
                        }
                    }
                }
            }
        });
    } finally {
        await client.end();
    }
}

const isMainModule =
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    process.argv[1]?.endsWith("seed.ts");

if (isMainModule) {
    const connectionUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionUrl) {
        throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required to run src/db/seed.ts.");
    }

    seedDatabase(connectionUrl)
        .then(() => {
            console.info("SYComP OMS database seed completed.");
        })
        .catch((error) => {
            console.error("Database seed failed:", error);
            process.exit(1);
        });
}
