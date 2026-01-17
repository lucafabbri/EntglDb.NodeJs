import * as crypto from 'crypto';

const KEY_SIZE = 32; // 256 bits
const BLOCK_SIZE = 16; // 128 bits
const MAC_SIZE = 32; // 256 bits (HMACSHA256)

/**
 * Encryption/decryption result
 */
export interface EncryptResult {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
}

/**
 * Cryptographic helper for AES-256-CBC + HMAC-SHA256
 * Compatible with .NET implementation in EntglDb.Net
 */
export class CryptoHelper {
    /**
     * Encrypt plaintext using AES-256-CBC with HMAC-SHA256 authentication
     * @param plaintext - Data to encrypt
     * @param key - 256-bit encryption key
     * @returns Encryption result with ciphertext, IV, and authentication tag
     */
    static encrypt(plaintext: Buffer, key: Buffer): EncryptResult {
        // Generate random IV
        const iv = crypto.randomBytes(BLOCK_SIZE);

        // Encrypt using AES-256-CBC
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final()
        ]);

        // Compute HMAC over IV + Ciphertext
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(iv);
        hmac.update(ciphertext);
        const tag = hmac.digest();

        return { ciphertext, iv, tag };
    }

    /**
     * Decrypt ciphertext using AES-256-CBC with HMAC-SHA256 verification
     * @param ciphertext - Encrypted data
     * @param iv - Initialization vector
     * @param tag - Authentication tag
     * @param key - 256-bit decryption key
     * @returns Decrypted plaintext
     * @throws Error if authentication fails
     */
    static decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer, key: Buffer): Buffer {
        // Verify HMAC
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(iv);
        hmac.update(ciphertext);
        const computedTag = hmac.digest();

        if (!this.fixedTimeEquals(tag, computedTag)) {
            throw new Error('Authentication failed (HMAC mismatch)');
        }

        // Decrypt using AES-256-CBC
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
    }

    /**
     * Constant-time buffer comparison to prevent timing attacks
     */
    private static fixedTimeEquals(a: Buffer, b: Buffer): boolean {
        return crypto.timingSafeEqual(a, b);
    }
}
