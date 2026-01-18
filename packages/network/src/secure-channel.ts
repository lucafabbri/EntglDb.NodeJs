import * as net from 'net';
import { CipherState, CryptoHelper } from './security';
import { SecureEnvelope } from '@entgldb/protocol';
import { CompressionHelper } from './compression-helper';

export class SecureChannel {
    private buffer = Buffer.alloc(0);
    private cipherState?: CipherState;
    public useCompression = false;

    // Callback for received messages
    public onMessage?: (type: number, payload: Buffer) => Promise<void> | void;
    public onError?: (error: Error) => void;

    constructor(private readonly socket: net.Socket) {
        socket.on('data', (data) => this.handleData(data));
        socket.on('error', (err) => this.onError?.(err));
    }

    /**
     * Set encryption state
     */
    setCipherState(state: CipherState) {
        this.cipherState = state;
    }

    /**
     * Send a message
     */
    async sendMessage(type: number, payload: Uint8Array): Promise<void> {
        let finalType = type;
        let finalPayload = Buffer.from(payload);
        let compressionFlag = 0;

        // 1. Compress
        if (this.useCompression && finalPayload.length > CompressionHelper.THRESHOLD) {
            const compressed = await CompressionHelper.compress(finalPayload);
            if (compressed.length < finalPayload.length) {
                finalPayload = compressed;
                compressionFlag = 1;
            }
        }

        // 2. Encrypt
        if (this.cipherState) {
            // Inner format: [Type (1)][Comp (1)][Payload]
            const inner = Buffer.concat([
                Buffer.from([finalType, compressionFlag]),
                finalPayload
            ]);

            const { ciphertext, iv, tag } = CryptoHelper.encrypt(inner, this.cipherState.encryptKey);

            const env = SecureEnvelope.create({
                ciphertext,
                nonce: iv,
                authTag: tag
            });

            finalPayload = Buffer.from(SecureEnvelope.toBinary(env));
            finalType = 9; // SecureEnv type (hardcoded or from Proto enum if available)
            compressionFlag = 0; // Outer is valid/uncompressed
        }

        // 3. Frame: [Length (4 LE)][Type (1)][Comp (1)][Payload]
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32LE(finalPayload.length); // Little Endian for .NET compat

        const frame = Buffer.concat([
            length,
            Buffer.from([finalType]),
            Buffer.from([compressionFlag]),
            finalPayload
        ]);

        this.socket.write(frame);
    }

    public disconnect() {
        this.socket.end();
    }

    private async handleData(data: Buffer) {
        this.buffer = Buffer.concat([this.buffer, data]);

        // Frame: [Length (4 LE)][Type (1)][Comp (1)][Payload]
        // Length covers [Payload]. It does NOT cover Type/Comp?
        // In .NET: "WriteAsync(length)... WriteByte(type)... WriteByte(comp)... WriteAsync(payload)".
        // Length = payloadBytes.Length.
        // So Frame size = 4 + 1 + 1 + Length.
        // Wait, review .NET `TcpPeerClient.cs` Step 3062 snippet:
        /*
            var length = BitConverter.GetBytes(payloadBytes.Length);
            await _stream.WriteAsync(length, 0, 4);
            _stream.WriteByte((byte)type);
            _stream.WriteByte(compressionFlag);
            await _stream.WriteAsync(payloadBytes...);
        */
        // Yes, Length is specifically PAYLOAD length.

        while (this.buffer.length >= 4) {
            // Read Length (LE)
            const payloadLength = this.buffer.readUInt32LE(0);

            // Need 4 (Len) + 1 (Type) + 1 (Comp) + PayloadLength
            const totalFrameSize = 4 + 1 + 1 + payloadLength;

            if (this.buffer.length < totalFrameSize) {
                break;
            }

            const messageType = this.buffer[4];
            const compFlag = this.buffer[5];
            let payload = this.buffer.subarray(6, 6 + payloadLength);

            // Advance buffer
            this.buffer = this.buffer.subarray(totalFrameSize);

            // Process
            try {
                // Decrypt SecureEnv
                // 9 = SecureEnv (Assumed constant, check Proto)
                if (messageType === 9) {
                    if (!this.cipherState) throw new Error("Received Encrypted message without keys");
                    const env = SecureEnvelope.fromBinary(payload);

                    const decrypted = CryptoHelper.decrypt(
                        env.ciphertext,
                        env.nonce,
                        env.authTag || Buffer.alloc(0), // handle optional
                        this.cipherState.decryptKey
                    );

                    // Decrypted: [Type (1)][Comp (1)][Payload]
                    if (decrypted.length < 2) throw new Error("Decrypted too short");

                    const innerType = decrypted[0];
                    const innerComp = decrypted[1];
                    let innerPayload = decrypted.subarray(2);

                    if (innerComp === 1) {
                        innerPayload = await CompressionHelper.decompress(innerPayload);
                    }

                    if (this.onMessage) await this.onMessage(innerType, innerPayload);
                } else {
                    // Unencrypted
                    if (compFlag === 1) {
                        payload = await CompressionHelper.decompress(payload);
                    }
                    if (this.onMessage) await this.onMessage(messageType, payload);
                }
            } catch (e) {
                console.error("SecureChannel message error", e);
                if (this.onError) this.onError(e as Error);
            }
        }
    }
}
