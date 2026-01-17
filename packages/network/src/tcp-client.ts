import * as net from 'net';
import { HLClock } from '@entgldb/core';
import {
    HandshakeRequest,
    HandshakeResponse,
    SyncRequest,
    SyncResponse,
    HLCTimestamp,
    PROTOCOL_VERSION
} from '@entgldb/protocol';
import { IPeerHandshakeService, CipherState, CryptoHelper } from './security';

export interface SyncClientOptions {
    nodeId: string;
    host: string;
    port: number;
    authToken?: string;
    handshakeService?: IPeerHandshakeService; // Optional security
}

/**
 * TCP sync client
 */
export class TcpSyncClient {
    private socket: net.Socket | null = null;
    private clock: HLClock;
    private responseHandlers = new Map<number, (data: Buffer) => void>();
    private messageId = 0;
    private cipherState?: CipherState; // Security state

    constructor(private readonly options: SyncClientOptions) {
        this.clock = new HLClock(options.nodeId);
    }

    /**
     * Connect to server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection({
                host: this.options.host,
                port: this.options.port
            });

            this.socket.on('connect', async () => {
                try {
                    // Perform secure handshake if service provided
                    if (this.options.handshakeService) {
                        const cipherState = await this.options.handshakeService.handshake(
                            this.socket!,
                            true, // isInitiator
                            this.options.nodeId
                        );
                        if (cipherState) {
                            this.cipherState = cipherState;
                        }
                    }

                    // Perform application handshake
                    await this.handshake();
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            this.socket.on('error', (error) => {
                reject(error);
            });

            this.socket.on('data', (data) => {
                this.handleData(data);
            });
        });
    }

    /**
     * Disconnect
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
    }

    /**
     * Perform handshake
     */
    private async handshake(): Promise<void> {
        const request = HandshakeRequest.create({
            nodeId: this.options.nodeId,
            protocolVersion: PROTOCOL_VERSION,
            authToken: this.options.authToken || '',
            supportedFeatures: []
        });

        const response = await this.sendRequest<HandshakeResponse>(
            1,
            HandshakeRequest.toBinary(request),
            (data) => HandshakeResponse.fromBinary(data)
        );

        if (!response.accepted) {
            throw new Error(`Handshake failed: ${response.errorMessage}`);
        }
    }

    /**
     * Pull changes from server
     */
    async pullChanges(since: HLCTimestamp, batchSize = 100): Promise<SyncResponse> {
        const request = SyncRequest.create({
            since,
            collections: [],
            batchSize
        });

        return this.sendRequest<SyncResponse>(
            2,
            SyncRequest.toBinary(request),
            (data) => SyncResponse.fromBinary(data)
        );
    }

    private async sendRequest<T>(
        messageType: number,
        payload: Uint8Array,
        decoder: (data: Uint8Array) => T
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const msgId = this.messageId++;

            this.responseHandlers.set(msgId, (data) => {
                try {
                    const response = decoder(data);
                    resolve(response);
                } catch (error) {
                    reject(error);
                } finally {
                    this.responseHandlers.delete(msgId);
                }
            });

            const typeBuffer = Buffer.from([messageType]);
            let messagePayload = Buffer.concat([typeBuffer, Buffer.from(payload)]);

            // Encrypt if cipher state is available
            if (this.cipherState) {
                const { ciphertext, iv, tag } = CryptoHelper.encrypt(messagePayload, this.cipherState.encryptKey);
                // Wire format: [iv_len(1)][iv][tag_len(1)][tag][ciphertext]
                messagePayload = Buffer.concat([
                    Buffer.from([iv.length]),
                    iv,
                    Buffer.from([tag.length]),
                    tag,
                    ciphertext
                ]);
            }

            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(messagePayload.length);
            const message = Buffer.concat([length, messagePayload]);

            this.socket!.write(message);

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.responseHandlers.has(msgId)) {
                    this.responseHandlers.delete(msgId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    private buffer = Buffer.alloc(0);

    private handleData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);

        while (this.buffer.length >= 4) {
            const messageLength = this.buffer.readUInt32BE(0);

            if (this.buffer.length < 4 + messageLength) {
                break;
            }

            let messageData = this.buffer.subarray(4, 4 + messageLength);
            this.buffer = this.buffer.subarray(4 + messageLength);

            // Decrypt if cipher state is available
            if (this.cipherState) {
                const ivLen = messageData[0];
                const iv = messageData.subarray(1, 1 + ivLen);
                const tagLen = messageData[1 + ivLen];
                const tag = messageData.subarray(2 + ivLen, 2 + ivLen + tagLen);
                const ciphertext = messageData.subarray(2 + ivLen + tagLen);

                messageData = CryptoHelper.decrypt(ciphertext, iv, tag, this.cipherState.decryptKey);
            }

            const messageType = messageData[0];
            const payload = messageData.subarray(1);

            // Call the first available handler (simple implementation)
            const handler = this.responseHandlers.values().next().value;
            if (handler) {
                handler(payload);
            }
        }
    }
}
