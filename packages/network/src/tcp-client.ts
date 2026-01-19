import * as net from 'net';
import { HLClock } from '@entgldb/core';
import {
    HandshakeRequest,
    HandshakeResponse,
    PullChangesRequest,
    ChangeSetResponse,
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
            throw new Error('Handshake failed');
        }

        if (response.selectedCompression === 'brotli') {
            if (this.channel) this.channel.useCompression = true;
        }
    }

    /**
     * Pull changes from server
     */
    async pullChanges(since: HLCTimestamp, batchSize = 100): Promise<ChangeSetResponse> {
        const { ProtocolMapper } = require('@entgldb/protocol');

        const request = PullChangesRequest.create({
            sinceWall: since.logicalTime,
            sinceLogic: since.counter,
            sinceNode: since.nodeId
        });

        return this.sendRequest<ChangeSetResponse>(
            5, // PullChangesReq
            PullChangesRequest.toBinary(request),
            (data) => ChangeSetResponse.fromBinary(data)
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

            this.channel!.sendMessage(messageType, payload).catch(reject);
        });
    }
}
