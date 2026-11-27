import { describe, expect, it, vi } from "vitest";
import type { AccountStatus, SystemRole } from "@/config/permissions";
import { AuthorizationError, authorize } from "./authorize";
import { toSafeUserDto, toSessionActorDto } from "./dto";

function makeActor(overrides?: Partial<{
    id: string;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
}>) {
    return {
        id: overrides?.id ?? "00000000-0000-0000-0000-000000000001",
        studentIdNumber: "2024-00001",
        firstName: "Test",
        middleName: null,
        lastName: "User",
        fullName: "Test User",
        universityEmail: "test.user@hnu.edu.ph",
        emailVerifiedAt: new Date("2026-08-01T00:00:00Z"),
        mustChangePassword: false,
        systemRole: overrides?.systemRole ?? "MEMBER",
        accountStatus: overrides?.accountStatus ?? "ACTIVE",
        statusReason: null,
        lastLoginAt: new Date("2026-08-02T00:00:00Z"),
    };
}

describe("authorize() 6-stage RBAC pipeline", () => {
    it("rejects missing session with 401", async () => {
        await expect(authorize({ actor: null }, "portal" as never)).rejects.toThrow();
        await expect(authorize({ actor: null }, "attendance:self:view")).rejects.toMatchObject({
            status: 401,
            code: "UNAUTHENTICATED",
        });
    });

    it("revokes sessions and returns 403 for DISABLED and NEEDS_REVIEW accounts (SEC-TEST-05)", async () => {
        const revokeAllUserSessions = vi.fn().mockResolvedValue(undefined);

        for (const accountStatus of ["DISABLED", "NEEDS_REVIEW"] as const) {
            await expect(
                authorize(
                    { actor: makeActor({ systemRole: "EXECUTIVE", accountStatus }) },
                    "event:public:view",
                    {},
                    { revokeAllUserSessions },
                ),
            ).rejects.toMatchObject({ status: 403, code: "ACCOUNT_HOLD" });
        }

        expect(revokeAllUserSessions).toHaveBeenCalledTimes(2);
    });

    it("enforces strict MEMBER isolation & IDOR protection (SEC-TEST-01)", async () => {
        const member = makeActor({ id: "member-1", systemRole: "MEMBER" });

        for (const perm of [
            "meeting:view",
            "event:draft:view",
            "committee:manage",
            "document:view",
            "audit_log:view",
            "checkpoint:manage",
        ] as const) {
            await expect(authorize({ actor: member }, perm)).rejects.toMatchObject({
                status: 403,
            });
        }

        await expect(
            authorize({ actor: member }, "attendance:self:view", { targetUserId: "member-2" }),
        ).rejects.toMatchObject({ status: 403, code: "IDOR_FORBIDDEN" });

        const ok = await authorize({ actor: member }, "attendance:self:view", {
            targetUserId: "member-1",
        });
        expect(ok.actor.id).toBe("member-1");
    });

    it("prevents OFFICER privilege escalation and enforces contextual Committee Head boundary (SEC-TEST-02 & 03)", async () => {
        const officer = makeActor({ id: "officer-1", systemRole: "OFFICER" });

        for (const perm of [
            "event:review:decide",
            "event:lifecycle:manage",
            "committee:manage",
            "checkpoint:manage",
            "announcement:publish",
            "appointment:manage",
        ] as const) {
            await expect(authorize({ actor: officer }, perm)).rejects.toMatchObject({
                status: 403,
            });
        }

        // Committee Head boundary
        const isCommitteeHead = vi.fn(async (_uid: string, cid: string) => cid === "committee-a");

        await expect(
            authorize(
                { actor: officer },
                "task:committee:manage",
                { committeeId: "committee-b", academicTermId: "term-1" },
                { isCommitteeHead },
            ),
        ).rejects.toMatchObject({ status: 403, code: "COMMITTEE_HEAD_REQUIRED" });

        const allowed = await authorize(
            { actor: officer },
            "task:committee:manage",
            { committeeId: "committee-a", academicTermId: "term-1" },
            { isCommitteeHead },
        );
        expect(allowed.actor.systemRole).toBe("OFFICER");
    });

    it("blocks OFFICER from scanning active Officer/Executive or non-ACTIVE targets (SEC-TEST-04 / BR-ATT-05)", async () => {
        const officer = makeActor({ id: "officer-1", systemRole: "OFFICER" });
        const exec = makeActor({ id: "exec-1", systemRole: "EXECUTIVE" });

        await expect(
            authorize({ actor: officer }, "attendance:scan", {
                targetUserId: "officer-2",
                targetSystemRole: "OFFICER",
                targetAccountStatus: "ACTIVE",
            }),
        ).rejects.toMatchObject({ status: 403, code: "OFFICER_SCAN_RESTRICTED" });

        await expect(
            authorize({ actor: exec }, "attendance:scan", {
                targetUserId: "member-2",
                targetSystemRole: "MEMBER",
                targetAccountStatus: "DISABLED",
            }),
        ).rejects.toMatchObject({ status: 403, code: "TARGET_ACCOUNT_HOLD" });

        const scanOk = await authorize({ actor: officer }, "attendance:scan", {
            targetUserId: "member-1",
            targetSystemRole: "MEMBER",
            targetAccountStatus: "ACTIVE",
        });
        expect(scanOk.isBreakGlass).toBe(false);
    });

    it("enforces SUPER_ADMIN Break-Glass rules (SEC-TEST-08) and temporal locks (BR-SYS-05)", async () => {
        const superAdmin = makeActor({ id: "sa-1", systemRole: "SUPER_ADMIN" });
        const exec = makeActor({ id: "exec-1", systemRole: "EXECUTIVE" });

        await expect(authorize({ actor: superAdmin }, "checkpoint:manage")).rejects.toMatchObject({
            status: 400,
            code: "BREAK_GLASS_REASON_REQUIRED",
        });

        await expect(
            authorize({ actor: superAdmin, breakGlass: true, reason: "too short" }, "checkpoint:manage"),
        ).rejects.toMatchObject({ status: 400, code: "BREAK_GLASS_REASON_REQUIRED" });

        const bgAllowed = await authorize(
            {
                actor: superAdmin,
                breakGlass: true,
                reason: "President unavailable during live event check-in.",
            },
            "checkpoint:manage",
            { termStatus: "CLOSED", eventStatus: "COMPLETED" },
        );
        expect(bgAllowed.isBreakGlass).toBe(true);

        await expect(
            authorize({ actor: exec }, "checkpoint:manage", { eventStatus: "COMPLETED" }),
        ).rejects.toMatchObject({ status: 409, code: "RESOURCE_LOCKED" });

        // Native SUPER_ADMIN mutation on CLOSED term still requires break-glass + reason
        await expect(
            authorize({ actor: superAdmin }, "appointment:manage", { termStatus: "CLOSED" }),
        ).rejects.toMatchObject({ status: 409, code: "RESOURCE_LOCKED" });

        await expect(
            authorize(
                { actor: superAdmin, breakGlass: true, reason: "short" },
                "appointment:manage",
                { termStatus: "CLOSED" },
            ),
        ).rejects.toMatchObject({ status: 400, code: "BREAK_GLASS_REASON_REQUIRED" });

        const closedOverride = await authorize(
            {
                actor: superAdmin,
                breakGlass: true,
                reason: "Correcting historical term appointment error.",
            },
            "appointment:manage",
            { termStatus: "CLOSED" },
        );
        expect(closedOverride.isBreakGlass).toBe(true);
    });

    it("never exposes passwordHash or tokenHash in SafeUserDto / SessionActorDto", () => {
        const raw = {
            ...makeActor(),
            passwordHash: "scrypt$16384$8$1$abc$def",
            tokenHash: "deadbeef",
        };
        const safeUser = toSafeUserDto(raw);
        const sessionActor = toSessionActorDto(raw);

        expect(JSON.stringify(safeUser)).not.toContain("passwordHash");
        expect(JSON.stringify(safeUser)).not.toContain("tokenHash");
        expect(JSON.stringify(sessionActor)).not.toContain("passwordHash");
        expect(JSON.stringify(sessionActor)).not.toContain("tokenHash");
        expect(AuthorizationError).toBeDefined();
    });

    it("enforces system_settings:view (SUPER_ADMIN only) and document_type:manage (SUPER_ADMIN & EXECUTIVE)", async () => {
        const superAdmin = makeActor({ id: "sa-1", systemRole: "SUPER_ADMIN" });
        const exec = makeActor({ id: "exec-1", systemRole: "EXECUTIVE" });
        const officer = makeActor({ id: "officer-1", systemRole: "OFFICER" });
        const member = makeActor({ id: "member-1", systemRole: "MEMBER" });

        await expect(authorize({ actor: superAdmin }, "system_settings:view")).resolves.toMatchObject({
            actor: { id: "sa-1" },
        });
        for (const denied of [exec, officer, member]) {
            await expect(authorize({ actor: denied }, "system_settings:view")).rejects.toMatchObject({
                status: 403,
            });
        }

        await expect(authorize({ actor: superAdmin }, "document_type:manage")).resolves.toMatchObject({
            isBreakGlass: false,
        });
        await expect(authorize({ actor: exec }, "document_type:manage")).resolves.toMatchObject({
            isBreakGlass: false,
        });
        for (const denied of [officer, member]) {
            await expect(authorize({ actor: denied }, "document_type:manage")).rejects.toMatchObject({
                status: 403,
            });
        }
    });
});
