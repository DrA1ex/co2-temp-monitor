import crypto from "node:crypto";

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEM = 32 * 1024 * 1024;

export async function hashPassword(password) {
    if (!password) throw new Error("Password is required");

    const salt = crypto.randomBytes(16).toString("base64url");
    const derivedKey = await scrypt(password, salt);

    return [
        "scrypt",
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELIZATION,
        SCRYPT_KEY_LENGTH,
        salt,
        derivedKey.toString("base64url"),
    ].join(":");
}

export async function verifyPassword(password, hash) {
    if (!password || !hash) return false;

    const [algorithm, costRaw, blockSizeRaw, parallelizationRaw, keyLengthRaw, salt, expectedHash] = hash.split(":");
    const cost = Number.parseInt(costRaw, 10);
    const blockSize = Number.parseInt(blockSizeRaw, 10);
    const parallelization = Number.parseInt(parallelizationRaw, 10);
    const keyLength = Number.parseInt(keyLengthRaw, 10);

    if (
        algorithm !== "scrypt"
        || !Number.isFinite(cost)
        || !Number.isFinite(blockSize)
        || !Number.isFinite(parallelization)
        || !Number.isFinite(keyLength)
        || !salt
        || !expectedHash
    ) {
        return false;
    }

    try {
        const actual = await scrypt(password, salt, {cost, blockSize, parallelization, keyLength});
        const expected = Buffer.from(expectedHash, "base64url");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function scrypt(
    password,
    salt,
    {
        cost = SCRYPT_COST,
        blockSize = SCRYPT_BLOCK_SIZE,
        parallelization = SCRYPT_PARALLELIZATION,
        keyLength = SCRYPT_KEY_LENGTH,
    } = {}
) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keyLength, {
            N: cost,
            r: blockSize,
            p: parallelization,
            maxmem: SCRYPT_MAX_MEM,
        }, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(derivedKey);
        });
    });
}
