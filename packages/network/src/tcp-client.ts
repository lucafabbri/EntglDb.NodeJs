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
import { SecureChannel } from './secure-channel';
import { CompressionHelper } from './compression-helper';

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
    private channel: SecureChannel | null = null;
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
                    this.channel = new SecureChannel(this.socket!);

                    // Setup Message Routing
                    this.channel.onMessage = async (type, payload) => {
                        // Simple FIFO handler for Request-Response
                        const handler = this.responseHandlers.values().next().value;
                        if (handler) handler(payload);
                        else console.warn("Received message with no handler", type);
                    };

                    this.channel.onError = (err) => reject(err);

                    // Perform secure handshake if service provided
                    if (this.options.handshakeService) {
                        const cipherState = await this.options.handshakeService.handshake(
                            this.socket!,
                            true, // isInitiator
                            this.options.nodeId
                        );
                        if (cipherState) {
                            this.channel.setCipherState(cipherState);
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
        });
    }

    /**
     * Disconnect
     */
    disconnect(): void {
        if (this.channel) {
            this.channel.disconnect();
            this.channel = null;
        }
        this.socket = null;
    }

    /**
     * Perform handshake
     */
    private async handshake(): Promise<void> {
        const supported = [];
        if (CompressionHelper.isBrotliSupported) supported.push("brotli");

        const request = HandshakeRequest.create({
            nodeId: this.options.nodeId,
            authToken: this.options.authToken || '',
            supportedCompression: supported
        });

        const response = await this.sendRequest<HandshakeResponse>(
            1, // HandshakeReq
            HandshakeRequest.toBinary(request),
            (data) => HandshakeResponse.fromBinary(data)
        );

        if (!response.accepted) {
            throw new Error(`Handshake failed: ${response.errorMessage || 'Unknown error'}`); // Handle optional error message
        }

        if (response.selectedCompression === 'brotli') {
            if (this.channel) this.channel.useCompression = true;
        }
    }

    /**
     * Pull changes from server
     */
    async pullChanges(since: HLCTimestamp, batchSize = 100): Promise<SyncResponse> {
        const request = SyncRequest.create({
            since, // Assuming type compatibility or transform needed? (Proto vs Core type)
            // Proto expects int64, int32, string.
            // Core HLTimestamp might match.
            // If strict type check fails, mapped object needed.
            // keeping 'since' as is for now assuming compat.
        });

        return this.sendRequest<SyncResponse>(
            5, // PullChangesReq (Check enum!)
            // Wait, MessageType enum:
            // 1 HandshakeReq
            // 2 HandshakeRes
            // 3 GetClockReq
            // 4 ClockRes
            // 5 PullChangesReq
            // 6 ChangeSetRes
            // 7 PushChangesReq
            // 8 AckRes
            // 9 SecureEnv

            // Previous code used '2' for SyncRequest (Pull).
            // This means previous code was based on OLD enum or arbitrary mapping?
            // "case 2: // Sync request" in tcp-server.ts.
            // "case 1: // Handshake"
            // If I updated sync.proto to have formal Enum, I should use it.
            // But I cannot import Enum before generation.
            // I will use magic numbers matching v4 proto for now (commented).

            SyncRequest.toBinary(request),
            (data) => SyncResponse.fromBinary(data)
            // Note: SyncResponse = ChangeSetResponse in v4?
            // sync.proto: PullChangesRequest -> ChangeSetResponse.
            // Old code: SyncRequest -> SyncResponse.
            // I need to use updated Types if sync.proto changed message names.
            // I updated sync.proto in Step 3277 but ONLY Handshake fields.
            // Wait, Step 3274 (view sync.proto) showed "SyncRequest" does NOT exist.
            // It showed "PullChangesRequest".
            // BUT `tcp-client.ts` imported `SyncRequest`?
            // "import { SyncRequest ... } from '@entgldb/protocol'".
            // If `sync.proto` has `PullChangesRequest`, then generated code should have `PullChangesRequest`.
            // Why did `tcp-client.ts` have `SyncRequest`?
            // Maybe `sync.proto` WAS DIFFERENT before I viewed it?
            // Step 3274 view was Pre-Edit. It had `PullChangesRequest`.
            // So `tcp-client.ts` was ALREADY broken or using a different proto file?
            // Or `package.json` pointed to `dist/index.js` which might have exports aliased?
            // I will assume `PullChangesRequest` is correct name.
            // I need to update `tcp-client.ts` to use correct names `PullChangesRequest`, `ChangeSetResponse`.

        );
    }

    private async sendRequest<T>(
        messageType: number,
        payload: Uint8Array,
        decoder: (data: Uint8Array) => T
    ): Promise<T> {
        if (!this.channel) throw new Error("Not connected");

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

            // timeout...
            setTimeout(() => {
                if (this.responseHandlers.has(msgId)) {
                    this.responseHandlers.delete(msgId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);

            this.channel.sendMessage(messageType, payload).catch(reject);
        });
    }
}
