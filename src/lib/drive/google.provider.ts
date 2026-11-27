import "server-only";
import {
    DriveServiceError,
    type DriveFileMetadata,
    type DriveProvider,
    type ResumableSessionInitInput,
    type ResumableSessionInitResult,
} from "./adapter";
import type { DrivePermissionPayload } from "./permissions";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface GoogleDriveProviderConfig {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    rootFolderId: string;
    fetchFn?: typeof fetch;
}

function escapeDriveQueryLiteral(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class GoogleDriveProvider implements DriveProvider {
    readonly mode = "google" as const;
    readonly rootFolderId: string;

    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly refreshToken: string;
    private readonly fetchFn: typeof fetch;
    private cachedAccessToken: string | null = null;
    private tokenExpiresAtMs = 0;

    constructor(config: GoogleDriveProviderConfig) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.refreshToken = config.refreshToken;
        this.rootFolderId = config.rootFolderId;
        this.fetchFn = config.fetchFn ?? fetch;
    }

    private async getAccessToken(): Promise<string> {
        const now = Date.now();
        if (this.cachedAccessToken && now < this.tokenExpiresAtMs) {
            return this.cachedAccessToken;
        }

        const body = new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
            grant_type: "refresh_token",
        });

        const res = await this.fetchFn(OAUTH_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_AUTH_FAILED",
                "Failed to refresh Google Drive access token.",
            );
        }

        const payload = (await res.json()) as {
            access_token?: string;
            expires_in?: number;
        };

        if (!payload.access_token) {
            throw new DriveServiceError(
                502,
                "DRIVE_AUTH_FAILED",
                "Google OAuth response did not contain an access token.",
            );
        }

        const ttlMs = Math.max(60, Number(payload.expires_in ?? 3600) - 60) * 1000;
        this.cachedAccessToken = payload.access_token;
        this.tokenExpiresAtMs = now + ttlMs;
        return payload.access_token;
    }

    private async driveFetch(url: string, init: RequestInit): Promise<Response> {
        const token = await this.getAccessToken();
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return this.fetchFn(url, { ...init, headers });
    }

    async verifyFolder(folderId: string): Promise<boolean> {
        const res = await this.driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=id,mimeType,trashed&supportsAllDrives=true`,
            { method: "GET" },
        );

        if (res.status === 404) {
            return false;
        }
        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_API_ERROR",
                "Unable to verify Google Drive folder state.",
            );
        }

        const data = (await res.json()) as {
            id?: string;
            mimeType?: string;
            trashed?: boolean;
        };
        return Boolean(data.id && data.mimeType === FOLDER_MIME_TYPE && !data.trashed);
    }

    async findOrCreateFolder(
        name: string,
        parentFolderId: string,
    ): Promise<{ folderId: string; created: boolean }> {
        const escapedName = escapeDriveQueryLiteral(name);
        const escapedParent = escapeDriveQueryLiteral(parentFolderId);
        const q = `name='${escapedName}' and '${escapedParent}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;

        const searchParams = new URLSearchParams({
            q,
            fields: "files(id)",
            pageSize: "1",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
        });

        const searchRes = await this.driveFetch(
            `${DRIVE_API_BASE}/files?${searchParams.toString()}`,
            { method: "GET" },
        );

        if (!searchRes.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_API_ERROR",
                "Failed to query Google Drive folders.",
            );
        }

        const searchPayload = (await searchRes.json()) as { files?: Array<{ id?: string }> };
        const existingId = searchPayload.files?.[0]?.id;
        if (existingId) {
            return { folderId: existingId, created: false };
        }

        const createRes = await this.driveFetch(
            `${DRIVE_API_BASE}/files?fields=id&supportsAllDrives=true`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=UTF-8" },
                body: JSON.stringify({
                    name,
                    mimeType: FOLDER_MIME_TYPE,
                    parents: [parentFolderId],
                }),
            },
        );

        if (!createRes.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_FOLDER_CREATE_FAILED",
                "Failed to create Google Drive folder.",
            );
        }

        const createdPayload = (await createRes.json()) as { id?: string };
        if (!createdPayload.id) {
            throw new DriveServiceError(
                502,
                "DRIVE_FOLDER_CREATE_FAILED",
                "Google Drive folder creation did not return a folder ID.",
            );
        }

        return { folderId: createdPayload.id, created: true };
    }

    async createResumableUploadSession(
        input: ResumableSessionInitInput,
    ): Promise<ResumableSessionInitResult> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": input.mimeType,
            "X-Upload-Content-Length": String(input.fileSizeBytes),
        };
        if (input.origin) {
            headers.Origin = input.origin;
        }

        const res = await this.driveFetch(
            `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    name: input.filename,
                    parents: [input.parentFolderId],
                    mimeType: input.mimeType,
                }),
            },
        );

        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_UPLOAD_INIT_FAILED",
                "Failed to initialize Google Drive resumable upload session.",
            );
        }

        const uploadUrl = res.headers.get("location")?.trim();
        if (!uploadUrl) {
            throw new DriveServiceError(
                502,
                "DRIVE_UPLOAD_INIT_FAILED",
                "Google Drive did not return a resumable upload session URI.",
            );
        }

        return { uploadUrl };
    }

    async getFileMetadata(fileId: string): Promise<DriveFileMetadata | null> {
        const res = await this.driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,webViewLink,trashed&supportsAllDrives=true`,
            { method: "GET" },
        );

        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_API_ERROR",
                "Failed to inspect uploaded Google Drive file metadata.",
            );
        }

        const data = (await res.json()) as {
            id?: string;
            name?: string;
            mimeType?: string;
            size?: string | number;
            parents?: string[];
            webViewLink?: string;
            trashed?: boolean;
        };

        if (!data.id) {
            return null;
        }

        return {
            id: data.id,
            name: data.name ?? "document",
            mimeType: data.mimeType ?? "application/octet-stream",
            size: Number(data.size ?? 0),
            parents: Array.isArray(data.parents) ? data.parents : [],
            webViewLink:
                data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
            trashed: Boolean(data.trashed),
        };
    }

    async readFileHeaderBytes(fileId: string, byteCount = 64): Promise<Uint8Array | null> {
        const endByte = Math.max(0, byteCount - 1);
        const res = await this.driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
            {
                method: "GET",
                headers: { Range: `bytes=0-${endByte}` },
            },
        );

        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_API_ERROR",
                "Failed to read uploaded file header from Google Drive.",
            );
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.slice(0, byteCount);
    }

    async setFilePermission(fileId: string, permission: DrivePermissionPayload): Promise<void> {
        const res = await this.driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=UTF-8" },
                body: JSON.stringify(permission),
            },
        );

        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_PERMISSION_FAILED",
                "Failed to apply Google Drive sharing permissions.",
            );
        }
    }

    async deleteFile(fileId: string): Promise<void> {
        const res = await this.driveFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
            { method: "DELETE" },
        );

        if (res.status === 404) {
            return;
        }
        if (!res.ok) {
            throw new DriveServiceError(
                502,
                "DRIVE_DELETE_FAILED",
                "Failed to delete Google Drive file during cleanup.",
            );
        }
    }
}
