import * as crypto from 'crypto';
import { Socket } from 'net';
import { IPeerHandshakeService, CipherState } from './types';

/**
 * Secure handshake service using ECDH P-256 key exchange
 * Compatible with .NET implementation in EntglDb.Net
 * 
 * Protocol:
 * 1. Initiator → Responder: [4 bytes BE length][public key DER/SubjectPublicKeyInfo]
 * 2. Responder → Initiator: [4 bytes BE length][public key DER/SubjectPublicKeyInfo]
 * 3. Both derive shared secret, then split into encryptKey/decryptKey
 */
export class SecureHandshakeService implements IPeerHandshakeService {
    async handshake(socket: Socket, isInitiator: boolean, nodeId: string): Promise<CipherState> {
        // 1. Generate ECDH key pair (P-256 curve, same as .NET)
        const ecdh = crypto.createECDH('prime256v1');
        ecdh.generateKeys();

        // 2. Export public key in DER format (SubjectPublicKeyInfo)
        // Node.js ECDH.getPublicKey() returns raw key, we need to wrap it in DER
        const rawPublicKey = ecdh.getPublicKey();
        const publicKeyDER = this.wrapPublicKeyDER(rawPublicKey);

        // 3. Send: [4 bytes Big Endian length][public key]
        await this.sendKey(socket, publicKeyDER);

        // 4. Receive peer public key
        const peerPublicKeyDER = await this.receiveKey(socket);

        // 5. Extract raw public key from DER and compute shared secret
        const peerRawPublicKey = this.unwrapPublicKeyDER(peerPublicKeyDER);
        const sharedSecret = ecdh.computeSecret(peerRawPublicKey);

        // 6. Derive session keys (HKDF-like with SHA256, same as .NET)
        const key1 = this.deriveKey(sharedSecret, 0);
        const key2 = this.deriveKey(sharedSecret, 1);

        // 7. Assign keys based on role (same as .NET)
        const encryptKey = isInitiator ? key1 : key2;
        const decryptKey = isInitiator ? key2 : key1;

        return new CipherState(encryptKey, decryptKey);
    }

    private async sendKey(socket: Socket, publicKey: Buffer): Promise<void> {
        const lengthBuf = Buffer.allocUnsafe(4);
        lengthBuf.writeUInt32BE(publicKey.length, 0);

        return new Promise((resolve, reject) => {
            socket.write(Buffer.concat([lengthBuf, publicKey]), (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private async receiveKey(socket: Socket): Promise<Buffer> {
        // Read 4 bytes length prefix (Big Endian)
        const lengthBuf = await this.readExact(socket, 4);
        const length = lengthBuf.readUInt32BE(0);

        // Read public key
        return await this.readExact(socket, length);
    }

    private readExact(socket: Socket, bytes: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);

            const onData = (data: Buffer) => {
                buffer = Buffer.concat([buffer, data]);

                if (buffer.length >= bytes) {
                    socket.off('data', onData);
                    socket.off('error', onError);
                    socket.off('end', onEnd);

                    const result = buffer.slice(0, bytes);
                    // Put back extra data
                    if (buffer.length > bytes) {
                        socket.unshift(buffer.slice(bytes));
                    }
                    resolve(result);
                }
            };

            const onError = (err: Error) => {
                socket.off('data', onData);
                socket.off('end', onEnd);
                reject(err);
            };

            const onEnd = () => {
                socket.off('data', onData);
                socket.off('error', onError);
                reject(new Error('Socket ended before reading complete'));
            };

            socket.on('data', onData);
            socket.on('error', onError);
            socket.on('end', onEnd);

            // Timeout after 30 seconds
            setTimeout(() => {
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('end', onEnd);
                reject(new Error('Handshake timeout'));
            }, 30000);
        });
    }

    private deriveKey(sharedSecret: Buffer, suffix: number): Buffer {
        const input = Buffer.concat([sharedSecret, Buffer.from([suffix])]);
        return crypto.createHash('sha256').update(input).digest();
    }

    /**
     * Wrap raw P-256 public key in DER/SubjectPublicKeyInfo format
     * This matches .NET's ECDiffieHellman.ExportSubjectPublicKeyInfo()
     */
    private wrapPublicKeyDER(rawPublicKey: Buffer): Buffer {
        // DER encoding for P-256 public key (SubjectPublicKeyInfo)
        // Structure: SEQUENCE { SEQUENCE { OID, OID }, BIT STRING }

        // P-256 OID: 1.2.840.10045.3.1.7
        const p256OID = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
        // EC Public Key OID: 1.2.840.10045.2.1
        const ecPublicKeyOID = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);

        // Algorithm identifier SEQUENCE
        const algSeq = Buffer.concat([
            Buffer.from([0x30, ecPublicKeyOID.length + p256OID.length]),
            ecPublicKeyOID,
            p256OID
        ]);

        // BIT STRING containing public key (prefix with 0x00 for no unused bits)
        const bitString = Buffer.concat([
            Buffer.from([0x03, rawPublicKey.length + 1, 0x00]),
            rawPublicKey
        ]);

        // Outer SEQUENCE
        const total = algSeq.length + bitString.length;
        return Buffer.concat([
            Buffer.from([0x30, total]),
            algSeq,
            bitString
        ]);
    }

    /**
     * Unwrap DER/SubjectPublicKeyInfo to get raw P-256 public key
     */
    private unwrapPublicKeyDER(der: Buffer): Buffer {
        // Simple DER parsing - extract BIT STRING content
        // Skip SEQUENCE, algorithm identifier, and BIT STRING header

        // Find BIT STRING (0x03)
        const bitStringIndex = der.indexOf(0x03);
        if (bitStringIndex === -1) {
            throw new Error('Invalid DER format: BIT STRING not found');
        }

        // Read length byte
        const length = der[bitStringIndex + 1];
        // Skip tag (1), length (1), unused bits (1)
        const rawKey = der.slice(bitStringIndex + 3, bitStringIndex + 3 + length - 1);

        return rawKey;
    }
}
