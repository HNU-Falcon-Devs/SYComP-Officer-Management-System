import "server-only";
import { randomUUID } from "node:crypto";
import {
    DriveServiceError,
    type DriveFileMetadata,
    type DriveProvider,
    type ResumableSessionInitInput,
    type ResumableSessionInitResult,
} from "./adapter";
import type { DrivePermissionPayload } from "./permissions";

interface MockFolderRecord {
    id: string;
    name: string;
    parentId: string | null;
    trashed: boolean;
}

interface MockUploadSession {
    sessionId: string;
    actorId: string;
    parentFolderId: string;
    filename: string;
    expectedMimeType: string;
    maxUploadSizeBytes: number;
    expiresAtMs: number;
    consumed: boolean;
}

interface MockFileRecord {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    parents: string[];
    webViewLink: string;
    trashed: boolean;
    headerBytes: Uint8Array;
    permissions: DrivePermissionPayload[];
}

export class MockDriveProvider implements DriveProvider {
    readonly mode = "mock" as const;
    rootFolderId: string;

    private folders = new Map<string, MockFolderRecord>();
    private sessions = new Map<string, MockUploadSession>();
    private files = new Map<string, MockFileRecord>();
    private failDeleteOnce = false;
    private failSetPermissionOnce = false;

    constructor(rootFolderId = "mock-root-folder") {
        this.rootFolderId = rootFolderId;
        this.reset(rootFolderId);
    }

    reset(rootFolderId = this.rootFolderId): void {
        this.rootFolderId = rootFolderId;
        this.folders.clear();
        this.sessions.clear();
        this.files.clear();
        this.failDeleteOnce = false;
        this.failSetPermissionOnce = false;
        this.folders.set(rootFolderId, {
            id: rootFolderId,
            name: "SYComP OMS Root",
            parentId: null,
            trashed: false,
        });
    }

    setFailureHooks(hooks: { failDeleteOnce?: boolean; failSetPermissionOnce?: boolean }): void {
        if (hooks.failDeleteOnce !== undefined) {
            this.failDeleteOnce = hooks.failDeleteOnce;
        }
        if (hooks.failSetPermissionOnce !== undefined) {
            this.failSetPermissionOnce = hooks.failSetPermissionOnce;
        }
    }

    trashFolder(folderId: string): void {
        const folder = this.folders.get(folderId);
        if (folder) {
            folder.trashed = true;
        }
    }

    hasFile(fileId: string): boolean {
        const file = this.files.get(fileId);
        return Boolean(file && !file.trashed);
    }

    getFilePermissions(fileId: string): DrivePermissionPayload[] {
        return this.files.get(fileId)?.permissions ?? [];
    }

    async verifyFolder(folderId: string): Promise<boolean> {
        const folder = this.folders.get(folderId);
        return Boolean(folder && !folder.trashed);
    }

    async findOrCreateFolder(
        name: string,
        parentFolderId: string,
    ): Promise<{ folderId: string; created: boolean }> {
        for (const folder of this.folders.values()) {
            if (!folder.trashed && folder.parentId === parentFolderId && folder.name === name) {
                return { folderId: folder.id, created: false };
            }
        }

        const folderId = `mock-folder-${randomUUID()}`;
        this.folders.set(folderId, {
            id: folderId,
            name,
            parentId: parentFolderId,
            trashed: false,
        });
        return { folderId, created: true };
    }

    async createResumableUploadSession(
        input: ResumableSessionInitInput,
    ): Promise<ResumableSessionInitResult> {
        const sessionId = randomUUID();
        this.sessions.set(sessionId, {
            sessionId,
            actorId: input.actorId,
            parentFolderId: input.parentFolderId,
            filename: input.filename,
            expectedMimeType: input.mimeType,
            maxUploadSizeBytes: input.maxUploadSizeBytes,
            expiresAtMs: Date.now() + 15 * 60 * 1000,
            consumed: false,
        });

        return {
            uploadUrl: `/api/documents/mock-upload?sessionId=${encodeURIComponent(sessionId)}`,
            mockSessionId: sessionId,
        };
    }

    completeMockUpload(
        sessionId: string,
        actorId: string,
        payload: { bytes: Uint8Array; contentType?: string | null; declaredSize?: number },
    ): { id: string; name: string; mimeType: string; size: number } {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new DriveServiceError(404, "MOCK_SESSION_NOT_FOUND", "Upload session not found.");
        }
        if (session.actorId !== actorId) {
            throw new DriveServiceError(
                403,
                "FORBIDDEN",
                "Upload session belongs to a different user.",
            );
        }
        if (session.consumed || Date.now() > session.expiresAtMs) {
            throw new DriveServiceError(
                400,
                "MOCK_SESSION_EXPIRED",
                "Upload session has expired or was already completed.",
            );
        }

        const size = payload.declaredSize ?? payload.bytes.length;
        if (payload.bytes.length === 0 || size <= 0) {
            throw new DriveServiceError(400, "EMPTY_FILE", "Uploaded file cannot be empty.");
        }
        if (size > session.maxUploadSizeBytes || payload.bytes.length > session.maxUploadSizeBytes) {
            throw new DriveServiceError(
                413,
                "FILE_TOO_LARGE",
                "Uploaded file exceeds maximum allowed size.",
            );
        }

        session.consumed = true;
        const id = `mock-file-${randomUUID()}`;
        const mimeType =
            payload.contentType?.split(";")[0]?.trim().toLowerCase() || session.expectedMimeType;

        this.files.set(id, {
            id,
            name: session.filename,
            mimeType,
            size,
            parents: [session.parentFolderId],
            webViewLink: `https://drive.google.com/file/d/${id}/view`,
            trashed: false,
            headerBytes: payload.bytes.slice(0, 64),
            permissions: [],
        });

        return {
            id,
            name: session.filename,
            mimeType,
            size,
        };
    }

    seedFileForTest(input: {
        id?: string;
        name: string;
        mimeType: string;
        size: number;
        parents: string[];
        headerBytes: Uint8Array;
    }): string {
        const id = input.id ?? `mock-file-${randomUUID()}`;
        this.files.set(id, {
            id,
            name: input.name,
            mimeType: input.mimeType,
            size: input.size,
            parents: input.parents,
            webViewLink: `https://drive.google.com/file/d/${id}/view`,
            trashed: false,
            headerBytes: input.headerBytes.slice(0, 64),
            permissions: [],
        });
        return id;
    }

    async getFileMetadata(fileId: string): Promise<DriveFileMetadata | null> {
        const file = this.files.get(fileId);
        if (!file) {
            return null;
        }
        return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            parents: [...file.parents],
            webViewLink: file.webViewLink,
            trashed: file.trashed,
        };
    }

    async readFileHeaderBytes(fileId: string, byteCount = 64): Promise<Uint8Array | null> {
        const file = this.files.get(fileId);
        if (!file || file.trashed) {
            return null;
        }
        return file.headerBytes.slice(0, byteCount);
    }

    async setFilePermission(fileId: string, permission: DrivePermissionPayload): Promise<void> {
        if (this.failSetPermissionOnce) {
            this.failSetPermissionOnce = false;
            throw new DriveServiceError(
                502,
                "DRIVE_PERMISSION_FAILED",
                "Simulated Drive permission assignment failure.",
            );
        }
        const file = this.files.get(fileId);
        if (!file || file.trashed) {
            throw new DriveServiceError(404, "DRIVE_FILE_NOT_FOUND", "Drive file not found.");
        }
        file.permissions.push(permission);
    }

    async deleteFile(fileId: string): Promise<void> {
        if (this.failDeleteOnce) {
            this.failDeleteOnce = false;
            throw new DriveServiceError(
                502,
                "DRIVE_DELETE_FAILED",
                "Simulated Drive cleanup deletion failure.",
            );
        }
        this.files.delete(fileId);
    }
}

const globalForMockDrive = globalThis as unknown as {
    __sycompMockDriveProvider?: MockDriveProvider;
};

export function getMockDriveProvider(rootFolderId = "mock-root-folder"): MockDriveProvider {
    if (!globalForMockDrive.__sycompMockDriveProvider) {
        globalForMockDrive.__sycompMockDriveProvider = new MockDriveProvider(rootFolderId);
    }
    return globalForMockDrive.__sycompMockDriveProvider;
}
