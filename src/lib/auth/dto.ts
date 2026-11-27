import type { AccountStatus, SystemRole } from "@/config/permissions";

export interface UserRecordLike {
    id: string;
    studentIdNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    fullName: string;
    universityEmail: string | null;
    emailVerifiedAt: Date | null;
    mustChangePassword: boolean;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
    statusReason: string | null;
    lastLoginAt: Date | null;
    createdAt?: Date;
}

export interface SafeUserDto {
    id: string;
    studentIdNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    fullName: string;
    universityEmail: string | null;
    emailVerifiedAt: string | null;
    mustChangePassword: boolean;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
    statusReason: string | null;
    lastLoginAt: string | null;
}

export interface SessionActorDto {
    id: string;
    studentIdNumber: string;
    fullName: string;
    universityEmail: string | null;
    emailVerified: boolean;
    mustChangePassword: boolean;
    systemRole: SystemRole;
    accountStatus: AccountStatus;
}

export function toSafeUserDto(user: UserRecordLike): SafeUserDto {
    return {
        id: user.id,
        studentIdNumber: user.studentIdNumber,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        fullName: user.fullName,
        universityEmail: user.universityEmail,
        emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
        mustChangePassword: user.mustChangePassword,
        systemRole: user.systemRole,
        accountStatus: user.accountStatus,
        statusReason: user.statusReason,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    };
}

export function toSessionActorDto(user: UserRecordLike): SessionActorDto {
    return {
        id: user.id,
        studentIdNumber: user.studentIdNumber,
        fullName: user.fullName,
        universityEmail: user.universityEmail,
        emailVerified: user.emailVerifiedAt !== null,
        mustChangePassword: user.mustChangePassword,
        systemRole: user.systemRole,
        accountStatus: user.accountStatus,
    };
}
