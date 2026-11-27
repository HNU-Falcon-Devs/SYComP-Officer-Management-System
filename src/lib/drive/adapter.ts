import "server-only";
import { getEnv, type Env } from "@/config/env";
import { GoogleDriveProvider } from "./google.provider";
import { MockDriveProvider, getMockDriveProvider } from "./mock.provider";
import type { DrivePermissionPayload } from "./permissions";

export interface DriveFileMetadata {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    parents: string[];
    webViewLink: string;
    trashed: boolean;
}

export interface ResumableSessionInitInput {
    actorId: string;
    parentFolderId: string;
    filename: string;
    mimeType: string;
    fileSizeBytes: number;
    maxUploadSizeBytes: number;
    origin?: string | null;
}

export interface ResumableSessionInitResult {
    uploadUrl: string;
    mockSessionId?: string;
}

export interface DriveProvider {
    readonly mode: "google" | "mock";
    readonly rootFolderId: string;
    verifyFolder(folderId: string): Promise<boolean>;
    findOrCreateFolder(
        name: string,
        parentFolderId: string,
    ): Promise<{ folderId: string; created: boolean }>;
    createResumableUploadSession(
        input: ResumableSessionInitInput,
    ): Promise<ResumableSessionInitResult>;
    getFileMetadata(fileId: string): Promise<DriveFileMetadata | null>;
    readFileHeaderBytes(fileId: string, byteCount?: number): Promise<Uint8Array | null>;
    setFilePermission(fileId: string, permission: DrivePermissionPayload): Promise<void>;
    deleteFile(fileId: string): Promise<void>;
}

export class DriveServiceError extends Error {
    readonly status: 400 | 403 | 404 | 413 | 502 | 503;
    readonly code: string;

    constructor(status: 400 | 403 | 404 | 413 | 502 | 503, code: string, message: string) {
        super(message);
        this.name = "DriveServiceError";
        this.status = status;
        this.code = code;
    }
}

const PLACEHOLDER_PREFIX_RE = /^(?:your-|placeholder|replace-with|mock-)/i;

export function isPlaceholderDriveConfig(
    env: Pick<
        Env,
        | "GOOGLE_DRIVE_CLIENT_ID"
        | "GOOGLE_DRIVE_CLIENT_SECRET"
        | "GOOGLE_DRIVE_REFRESH_TOKEN"
        | "GOOGLE_DRIVE_ROOT_FOLDER_ID"
    >,
): boolean {
    const values = [
        env.GOOGLE_DRIVE_CLIENT_ID,
        env.GOOGLE_DRIVE_CLIENT_SECRET,
        env.GOOGLE_DRIVE_REFRESH_TOKEN,
        env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    ];
    return values.some((value) => {
        const trimmed = value.trim();
        return !trimmed || PLACEHOLDER_PREFIX_RE.test(trimmed);
    });
}

let providerOverride: DriveProvider | null = null;

export function setDriveProviderOverrideForTest(provider: DriveProvider | null): void {
    providerOverride = provider;
}

export function createDriveProvider(env: Env = getEnv()): DriveProvider {
    const isProduction = process.env.NODE_ENV === "production";
    const explicitMock = process.env.DRIVE_PROVIDER?.trim().toLowerCase() === "mock";

    if (explicitMock && !isProduction) {
        return getMockDriveProvider(env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "mock-root-folder");
    }

    if (isPlaceholderDriveConfig(env)) {
        if (isProduction) {
            throw new DriveServiceError(
                503,
                "DRIVE_NOT_CONFIGURED",
                "Google Drive integration credentials are not configured on the server.",
            );
        }
        return getMockDriveProvider(env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "mock-root-folder");
    }

    return new GoogleDriveProvider({
        clientId: env.GOOGLE_DRIVE_CLIENT_ID,
        clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
        refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN,
        rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    });
}

export function getDriveProvider(env?: Env): DriveProvider {
    if (providerOverride) {
        return providerOverride;
    }
    return createDriveProvider(env);
}

export { MockDriveProvider, getMockDriveProvider };
