export const SYSTEM_ROLES = ["SUPER_ADMIN", "EXECUTIVE", "OFFICER", "MEMBER"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED", "NEEDS_REVIEW"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type Permission =
    // Identity, Account Lifecycle & Term Governance
    | "masterlist:import"
    | "masterlist:view"
    | "user:status:update"
    | "user:password:admin_reset"
    | "directory:view"
    | "account:self:update"
    | "term:manage"
    | "appointment:manage"
    | "term:history:view"
    // Events, Proposals, Committees & Tasks
    | "event:proposal:create"
    | "event:draft:view"
    | "event:workspace:view"
    | "event:public:view"
    | "event:proposal:edit"
    | "event:review:comment"
    | "event:review:decide"
    | "event:lifecycle:manage"
    | "committee:manage"
    | "committee:members:manage"
    | "task:committee:manage"
    | "task:general:manage"
    | "task:assignee:progress"
    | "task:review:complete"
    // Officer Meetings & Dynamic Attendance
    | "meeting:view"
    | "meeting:manage"
    | "meeting:minutes:edit"
    | "checkpoint:manage"
    | "attendance:scan"
    | "attendance:override"
    | "attendance:export"
    | "attendance:self:view"
    // Documents, Announcements & Audit Logs
    | "document_type:manage"
    | "document:upload"
    | "document:view"
    | "document:approve"
    | "announcement:draft"
    | "announcement:publish"
    | "announcement:public:view"
    | "announcement:officers:view"
    | "audit_log:view"
    | "system_settings:view";

export interface PermissionRule {
    nativeRoles: readonly SystemRole[];
    allowBreakGlass: boolean;
    isMutation: boolean;
    /** Allows EXECUTIVE (with mandatory reason) to perform historical corrections on CLOSED terms. */
    allowExecutiveHistoricalOverride?: boolean;
}

const EXEC_ONLY_BG: PermissionRule = {
    nativeRoles: ["EXECUTIVE"],
    allowBreakGlass: true,
    isMutation: true,
};

const OFFICER_PLUS_MUTATION_BG: PermissionRule = {
    nativeRoles: ["EXECUTIVE", "OFFICER"],
    allowBreakGlass: true,
    isMutation: true,
};

const OFFICER_PLUS_VIEW: PermissionRule = {
    nativeRoles: ["SUPER_ADMIN", "EXECUTIVE", "OFFICER"],
    allowBreakGlass: false,
    isMutation: false,
};

const ALL_ACTIVE_SELF_OR_PUBLIC_VIEW: PermissionRule = {
    nativeRoles: ["SUPER_ADMIN", "EXECUTIVE", "OFFICER", "MEMBER"],
    allowBreakGlass: false,
    isMutation: false,
};

export const PERMISSIONS: Record<Permission, PermissionRule> = {
    // 4.1 Identity, Account Lifecycle & Term Governance
    "masterlist:import": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: true },
    "masterlist:view": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE"], allowBreakGlass: false, isMutation: false },
    "user:status:update": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: true },
    "user:password:admin_reset": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: true },
    "directory:view": OFFICER_PLUS_VIEW,
    "account:self:update": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE", "OFFICER", "MEMBER"], allowBreakGlass: false, isMutation: true },
    "term:manage": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: true },
    "appointment:manage": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: true },
    "term:history:view": OFFICER_PLUS_VIEW,

    // 4.2 Events, Proposals, Committees & Tasks
    "event:proposal:create": OFFICER_PLUS_MUTATION_BG,
    "event:draft:view": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE", "OFFICER"], allowBreakGlass: false, isMutation: false },
    "event:workspace:view": OFFICER_PLUS_VIEW,
    "event:public:view": ALL_ACTIVE_SELF_OR_PUBLIC_VIEW,
    "event:proposal:edit": OFFICER_PLUS_MUTATION_BG,
    "event:review:comment": OFFICER_PLUS_MUTATION_BG,
    "event:review:decide": EXEC_ONLY_BG,
    "event:lifecycle:manage": EXEC_ONLY_BG,
    "committee:manage": EXEC_ONLY_BG,
    "committee:members:manage": OFFICER_PLUS_MUTATION_BG,
    "task:committee:manage": OFFICER_PLUS_MUTATION_BG,
    "task:general:manage": EXEC_ONLY_BG,
    "task:assignee:progress": OFFICER_PLUS_MUTATION_BG,
    "task:review:complete": OFFICER_PLUS_MUTATION_BG,

    // 4.3 Officer Meetings & Dynamic Attendance
    "meeting:view": OFFICER_PLUS_VIEW,
    "meeting:manage": EXEC_ONLY_BG,
    "meeting:minutes:edit": OFFICER_PLUS_MUTATION_BG,
    "checkpoint:manage": EXEC_ONLY_BG,
    "attendance:scan": OFFICER_PLUS_MUTATION_BG,
    "attendance:override": { ...EXEC_ONLY_BG, allowExecutiveHistoricalOverride: true },
    "attendance:export": OFFICER_PLUS_VIEW,
    "attendance:self:view": ALL_ACTIVE_SELF_OR_PUBLIC_VIEW,

    // 4.4 Documents, Announcements & Audit Logs
    "document_type:manage": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE"], allowBreakGlass: false, isMutation: true },
    "document:upload": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE", "OFFICER"], allowBreakGlass: false, isMutation: true },
    "document:view": OFFICER_PLUS_VIEW,
    "document:approve": EXEC_ONLY_BG,
    "announcement:draft": OFFICER_PLUS_MUTATION_BG,
    "announcement:publish": EXEC_ONLY_BG,
    "announcement:public:view": ALL_ACTIVE_SELF_OR_PUBLIC_VIEW,
    "announcement:officers:view": OFFICER_PLUS_VIEW,
    "audit_log:view": { nativeRoles: ["SUPER_ADMIN", "EXECUTIVE"], allowBreakGlass: false, isMutation: false },
    "system_settings:view": { nativeRoles: ["SUPER_ADMIN"], allowBreakGlass: false, isMutation: false },
};
