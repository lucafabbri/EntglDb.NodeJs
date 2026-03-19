import * as net from 'net';
import { HLClock } from '@entgldb/core';
import {
    HandshakeRequest,
    HandshakeResponse,
    PullChangesRequest,
    ChangeSetResponse,
    GetVectorClockRequest,
    VectorClockResponse,
    VectorClockEntry,
    PushChangesRequest,
    GetChainRangeRequest,
    ChainRangeResponse,
    ProtoOplogEntry,
    HLCTimestamp,
    PROTOCOL_VERSION
} from '@entgldb/protocol';
import { ProtocolMapper } from '@entgldb/protocol';
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

    async getVectorClock(): Promise<VectorClockResponse> {
        const request = GetVectorClockRequest.create({});
        return this.sendRequest<VectorClockResponse>(
            12, // GetVectorClockReq
            GetVectorClockRequest.toBinary(request),
            (data) => VectorClockResponse.fromBinary(data)
        );
    }

    async pushChanges(oplogEntries: any[]): Promise<void> {
        // Convert domain entries to proto entries
        const protoEntries = oplogEntries.map(e => ProtocolMapper.toProtoOplogEntry(e));

        const request = PushChangesRequest.create({
            entries: protoEntries
        });

        // PushChangesReq = 7
        // We expect AckResponse (8) or just void/no response? 
        // Sync.proto says PushChangesReq(7) -> AckRes(8)?
        // .NET SyncOrchestrator sends PushChanges but doesn't explicitly wait for Ack in the loop?
        // Wait, .NET SyncOrchestrator: await client.PushChangesAsync(changesList, token);
        // TcpPeerClient.cs .NET: WriteMessageAsync(MessageType.PushChangesReq, ...); then ReadMessageAsync(MessageType.AckRes...);
        // So yes, we expect Ack.

        // I need to import AckResponse too.
        // For now I'll assume we wait for Ack.

        await this.sendRequest<any>(
            7,
            PushChangesRequest.toBinary(request),
            (data) => { } // decode AckResponse but we don't return it
        );
    }

    async getChainRange(startHash: string, endHash: string): Promise<ChainRangeResponse> {
        const request = GetChainRangeRequest.create({
            startHash,
            endHash
        });

        return this.sendRequest<ChainRangeResponse>(
            10, // GetChainRangeReq
            GetChainRangeRequest.toBinary(request),
            (data) => ChainRangeResponse.fromBinary(data)
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
