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

export interface SyncClientOptions {
    nodeId: string;
    host: string;
    port: number;
    authToken?: string;
}

/**
 * TCP sync client
 */
export class TcpSyncClient {
    private socket: net.Socket | null = null;
    private clock: HLClock;
    private responseHandlers = new Map<number, (data: Buffer) => void>();
    private messageId = 0;

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

            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(1 + payload.length);

            const typeBuffer = Buffer.from([messageType]);
            const message = Buffer.concat([length, typeBuffer, Buffer.from(payload)]);

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

            const messageData = this.buffer.subarray(4, 4 + messageLength);
            this.buffer = this.buffer.subarray(4 + messageLength);

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
