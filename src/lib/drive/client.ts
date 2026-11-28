import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import { driveFolderCache } from "@/db/schema";
import { isPgUniqueViolation } from "@/lib/admin/settings";
import { writeAuditLog } from "@/lib/audit";
import type { DriveProvider } from "./adapter";
import type { ResolvedDrivePath } from "./classifier";

export const UPLOAD_INTENT_TTL_MS = 15 * 60 * 1000;

export interface UploadIntentPayload {
    actorId: string;
    academicTermId: string;
    documentTypeId: string;
    eventId: string | null;
    meetingId: string | null;
    isProposalAttachment: boolean;
    title: string;
    initialStatus: "DRAFT" | "FOR_REVIEW";
    driveFolderCacheId: string;
    parentDriveFolderId: string;
    expectedFilename: string;
    expectedExtension: string;
    expectedMimeType: string;
    exp: number;
}

function signDigest(encodedPayload: string, secret: string): Buffer {
    return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function signUploadIntentToken(
    payload: Omit<UploadIntentPayload, "exp">,
    secret: string,
    nowMs = Date.now(),
): string {
    const fullPayload: UploadIntentPayload = {
        ...payload,
        exp: nowMs + UPLOAD_INTENT_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
    const sig = signDigest(encoded, secret).toString("base64url");
    return `${encoded}.${sig}`;
}

export function verifyUploadIntentToken(
    token: string,
    secret: string,
    nowMs = Date.now(),
): { ok: true; payload: UploadIntentPayload } | { ok: false; message: string } {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { ok: false, message: "Malformed upload intent token." };
    }

    const [encoded, sigPart] = parts;
    let providedSig: Buffer;
    try {
        providedSig = Buffer.from(sigPart, "base64url");
    } catch {
        return { ok: false, message: "Invalid upload intent signature encoding." };
    }

    const expectedSig = signDigest(encoded, secret);
    if (
        providedSig.length !== expectedSig.length ||
        !timingSafeEqual(providedSig, expectedSig)
    ) {
        return { ok: false, message: "Invalid upload intent signature." };
    }

    let parsed: UploadIntentPayload;
    try {
        parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UploadIntentPayload;
    } catch {
        return { ok: false, message: "Corrupted upload intent payload." };
    }

    if (
        !parsed ||
        typeof parsed.actorId !== "string" ||
        typeof parsed.academicTermId !== "string" ||
        typeof parsed.documentTypeId !== "string" ||
        typeof parsed.parentDriveFolderId !== "string" ||
        typeof parsed.driveFolderCacheId !== "string" ||
        typeof parsed.expectedExtension !== "string" ||
        typeof parsed.exp !== "number"
    ) {
        return { ok: false, message: "Incomplete upload intent payload." };
    }

    if (nowMs >= parsed.exp) {
        return { ok: false, message: "Upload session expired. Please restart the upload." };
    }

    return { ok: true, payload: parsed };
}

async function upsertFolderCacheRow(
    executor: DbExecutor,
    input: {
        academicTermId: string;
        pathKey: string;
        driveFolderId: string;
        parentDriveFolderId: string;
        now: Date;
    },
) {
    try {
        const [upserted] = await executor
            .insert(driveFolderCache)
            .values({
                academicTermId: input.academicTermId,
                pathKey: input.pathKey,
                driveFolderId: input.driveFolderId,
                parentDriveFolderId: input.parentDriveFolderId,
                lastVerifiedAt: input.now,
                createdAt: input.now,
                updatedAt: input.now,
            })
            .onConflictDoUpdate({
                target: driveFolderCache.pathKey,
                set: {
                    driveFolderId: input.driveFolderId,
                    parentDriveFolderId: input.parentDriveFolderId,
                    lastVerifiedAt: input.now,
                    updatedAt: input.now,
                },
            })
            .returning();

        return upserted;
    } catch (error) {
        // Handle concurrent race on unique drive_folder_id or path_key by reading existing row
        if (isPgUniqueViolation(error)) {
            const [byPath] = await executor
                .select()
                .from(driveFolderCache)
                .where(eq(driveFolderCache.pathKey, input.pathKey))
                .limit(1);
            if (byPath) {
                return byPath;
            }
            const [byFolder] = await executor
                .select()
                .from(driveFolderCache)
                .where(eq(driveFolderCache.driveFolderId, input.driveFolderId))
                .limit(1);
            if (byFolder) {
                return byFolder;
            }
        }
        throw error;
    }
}

export async function ensureDriveFolderHierarchy(
    executor: DbExecutor,
    provider: DriveProvider,
    input: {
        academicTermId: string;
        path: ResolvedDrivePath;
    },
): Promise<{ folderCacheId: string; driveFolderId: string; pathKey: string }> {
    const now = new Date();
    const leafPathKey = input.path.pathKey;

    const [cachedLeaf] = await executor
        .select()
        .from(driveFolderCache)
        .where(eq(driveFolderCache.pathKey, leafPathKey))
        .limit(1);

    if (cachedLeaf && (await provider.verifyFolder(cachedLeaf.driveFolderId))) {
        await executor
            .update(driveFolderCache)
            .set({ lastVerifiedAt: now, updatedAt: now })
            .where(eq(driveFolderCache.id, cachedLeaf.id));

        return {
            folderCacheId: cachedLeaf.id,
            driveFolderId: cachedLeaf.driveFolderId,
            pathKey: cachedLeaf.pathKey,
        };
    }

    let currentParentId = provider.rootFolderId;
    let leafRow = cachedLeaf;

    for (let i = 0; i < input.path.segments.length; i += 1) {
        const segmentName = input.path.segments[i];
        const segmentKey = input.path.segmentPathKeys[i];

        const [cachedSeg] = await executor
            .select()
            .from(driveFolderCache)
            .where(eq(driveFolderCache.pathKey, segmentKey))
            .limit(1);

        if (
            cachedSeg &&
            cachedSeg.parentDriveFolderId === currentParentId &&
            (await provider.verifyFolder(cachedSeg.driveFolderId))
        ) {
            currentParentId = cachedSeg.driveFolderId;
            leafRow = cachedSeg;
            continue;
        }

        const { folderId } = await provider.findOrCreateFolder(segmentName, currentParentId);
        const saved = await upsertFolderCacheRow(executor, {
            academicTermId: input.academicTermId,
            pathKey: segmentKey,
            driveFolderId: folderId,
            parentDriveFolderId: currentParentId,
            now,
        });
        currentParentId = saved.driveFolderId;
        leafRow = saved;
    }

    if (!leafRow) {
        throw new Error("Failed to resolve Drive folder hierarchy.");
    }

    return {
        folderCacheId: leafRow.id,
        driveFolderId: leafRow.driveFolderId,
        pathKey: leafRow.pathKey,
    };
}

export async function cleanupOrphanedDriveFile(
    executor: DbExecutor,
    provider: DriveProvider,
    input: {
        driveFileId: string;
        actorId: string | null;
        ipAddress: string | null;
        cause: string;
    },
): Promise<void> {
    try {
        await provider.deleteFile(input.driveFileId);
    } catch (cleanupError) {
        const message =
            cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup failure";
        try {
            await writeAuditLog(executor, {
                actorId: input.actorId,
                action: "DOCUMENT_ORPHAN_CLEANUP_FAILED",
                entityType: "document",
                entityId: randomUUID(),
                beforeState: null,
                afterState: {
                    driveFileId: input.driveFileId,
                    cause: input.cause,
                    cleanupError: message,
                },
                ipAddress: input.ipAddress,
            });
        } catch {
            // Best-effort audit logging so original upload error still surfaces cleanly
        }
    }
}
