import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback) as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

// Precomputed dummy scrypt hash for constant-time non-enumeration on unknown IDs
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_KEY_HEX = "00".repeat(SCRYPT_KEYLEN);

export function normalizeDefaultPassword(lastName: string, studentIdNumber: string): string {
    const normalizedLastName = lastName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();

    return `${normalizedLastName}${studentIdNumber.trim()}`;
}

export async function hashPassword(plaintext: string): Promise<string> {
    const saltHex = randomBytes(SALT_BYTES).toString("hex");
    const derived = await scryptAsync(plaintext, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });

    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltHex}$${derived.toString("hex")}`;
}

export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") {
        return false;
    }

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const saltHex = parts[4];
    const keyHex = parts[5];

    if (
        !Number.isInteger(n) ||
        !Number.isInteger(r) ||
        !Number.isInteger(p) ||
        n <= 1 ||
        r <= 0 ||
        p <= 0 ||
        !/^[0-9a-f]+$/i.test(saltHex) ||
        !/^[0-9a-f]+$/i.test(keyHex)
    ) {
        return false;
    }

    const expectedKey = Buffer.from(keyHex, "hex");
    if (expectedKey.length === 0) {
        return false;
    }

    const derived = await scryptAsync(plaintext, Buffer.from(saltHex, "hex"), expectedKey.length, {
        N: n,
        r,
        p,
        maxmem: 64 * 1024 * 1024,
    });

    return timingSafeEqual(derived, expectedKey);
}

export async function verifyPasswordOrDummy(
    plaintext: string,
    storedHash: string | null | undefined,
): Promise<boolean> {
    if (!storedHash) {
        await scryptAsync(plaintext, Buffer.from(DUMMY_SALT, "hex"), SCRYPT_KEYLEN, {
            N: SCRYPT_N,
            r: SCRYPT_R,
            p: SCRYPT_P,
        });
        timingSafeEqual(Buffer.from(DUMMY_KEY_HEX, "hex"), Buffer.from(DUMMY_KEY_HEX, "hex"));
        return false;
    }

    return verifyPassword(plaintext, storedHash);
}

export interface PasswordPolicyResult {
    valid: boolean;
    error?: string;
}

export function validateUserPasswordPolicy(
    password: string,
    studentIdNumber: string,
    lastName: string,
): PasswordPolicyResult {
    if (password.length < 10) {
        return { valid: false, error: "Password must be at least 10 characters long." };
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return { valid: false, error: "Password must include at least one letter and one number." };
    }

    const normalizedInput = password.trim().toLowerCase();
    if (normalizedInput === studentIdNumber.trim().toLowerCase()) {
        return { valid: false, error: "Password cannot match your Student ID number." };
    }

    const defaultPassword = normalizeDefaultPassword(lastName, studentIdNumber).toLowerCase();
    if (normalizedInput === defaultPassword) {
        return { valid: false, error: "Password cannot match your default provisioned password." };
    }

    return { valid: true };
}
