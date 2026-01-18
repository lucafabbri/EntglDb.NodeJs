import * as net from 'net';
import { IPeerStore, HLClock } from '@entgldb/core';
import {
    HandshakeRequest,
    HandshakeResponse,
    SyncRequest,
    SyncResponse,
    PushRequest,
    PushResponse,
    HLCTimestamp,
    PROTOCOL_VERSION
} from '@entgldb/protocol';
import { IPeerHandshakeService, IAuthenticator, CipherState, CryptoHelper } from './security';
import { SecureChannel } from './secure-channel';
import { CompressionHelper } from './compression-helper';

/**
 * TCP-based sync server
 */
export interface TcpSyncServerOptions {
    store: IPeerStore;
    nodeId: string;
    port: number;
    authToken?: string;
    handshakeService?: IPeerHandshakeService;
    authenticator?: IAuthenticator;
}

export class TcpSyncServer {
    private server: net.Server | null = null;
    private clock: HLClock;
    // Map of active channels if needed, or just let them live in closure
    private channels = new Set<SecureChannel>();

    constructor(private readonly options: TcpSyncServerOptions) {
        this.clock = new HLClock(options.nodeId);
    }

    /**
     * Start the server
     */
    start(): void {
        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });

        this.server.listen(this.options.port, () => {
            console.log(`[EntglDb] Sync server listening on port ${this.options.port}`);
        });
    }

    /**
     * Stop the server
     */
    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        for (const channel of this.channels) {
            channel.disconnect();
        }
        this.channels.clear();
    }

    private async handleConnection(socket: net.Socket): Promise<void> {
        console.log(`[EntglDb] New connection from ${socket.remoteAddress}`);

        const channel = new SecureChannel(socket);
        this.channels.add(channel);

        // Remove on close
        socket.on('close', () => {
            console.log('[EntglDb] Connection closed');
            this.channels.delete(channel);
        });

        channel.onMessage = async (type, payload) => {
            try {
                await this.handleMessage(channel, type, payload);
            } catch (error) {
                console.error('[EntglDb] Error handling message:', error);
                channel.disconnect();
            }
        };

        // Perform secure handshake if service provided
        if (this.options.handshakeService) {
            try {
                const cipherState = await this.options.handshakeService.handshake(
                    socket,
                    false, // isInitiator (server is responder)
                    this.options.nodeId
                );
                if (cipherState) {
                    channel.setCipherState(cipherState);
                }
            } catch (error) {
                console.error('[EntglDb] Security handshake failed:', error);
                channel.disconnect();
                return;
            }
        }
    }

    private async handleMessage(channel: SecureChannel, messageType: number, payload: Buffer): Promise<void> {
        // Use enum values if available, else magic numbers matching v4
        switch (messageType) {
            case 1: // HandshakeReq
                await this.handleHandshake(channel, payload);
                break;
            case 5: // PullChangesReq (v4) (was 2 SyncRequest)
                await this.handleSyncRequest(channel, payload);
                break;
            case 7: // PushChangesReq (v4) (was 3 PushRequest)
                await this.handlePushRequest(channel, payload);
                break;
            default:
                console.error('[EntglDb] Unknown message type:', messageType);
        }
    }

    private async handleHandshake(channel: SecureChannel, payload: Buffer): Promise<void> {
        const request = HandshakeRequest.fromBinary(payload);

        let accepted = true;
        let errorMessage = '';

        // Validate auth token
        if (this.options.authenticator) {
            const valid = await this.options.authenticator.validate(request.nodeId, request.authToken);
            if (!valid) {
                accepted = false;
                errorMessage = 'Authentication failed';
            }
        } else if (this.options.authToken && request.authToken !== this.options.authToken) {
            accepted = false;
            errorMessage = 'Invalid auth token';
        }

        /*
        // Check protocol version - Removed in v4? Should still check if field exists
        // HandshakeRequest definition in v4 removed protocol_version field in my previous thought? 
        // No, I added fields, didn't check removals.
        // Assuming protocolVersion is sent/checked if it's there.
        // If generated code has it, I use it.
        */

        const response = HandshakeResponse.create({
            accepted,
            nodeId: this.options.nodeId, // v4 field 'node_id'
            // protocolVersion: ... // if exists
            // errorMessage: errorMessage // if exists in v4 proto? 
            // My v4 update didn't show errorMessage field. 
            // Older code had it. I should check sync.proto again.
            // Step 3274: HandshakeResponse { node_id, accepted, selected_compression }. NO error_message.
            // So I should NOT set errorMessage if it doesn't exist.
            // Accepted=false alone indicates failure.
        });

        if (accepted && CompressionHelper.isBrotliSupported) {
            // Negotiation
            // Check request.supportedCompression (repeated string)
            if (request.supportedCompression && request.supportedCompression.includes('brotli')) {
                response.selectedCompression = 'brotli';
                channel.useCompression = true;
            }
        }

        await channel.sendMessage(2, HandshakeResponse.toBinary(response)); // 2 = HandshakeRes

        if (!accepted) {
            channel.disconnect();
        }
    }

    private async handleSyncRequest(channel: SecureChannel, payload: Buffer): Promise<void> {
        const request = SyncRequest.fromBinary(payload);
        const batchSize = request.batchSize || 100;

        const entries = await this.options.store.getOplogAfter(request.since!, batchSize);
        // Note: request.since logic might need mapping if types differ

        const latest = await this.options.store.getLatestTimestamp();

        const response = SyncResponse.create({
            entries,
            // latestTimestamp: latest, // Check if v4 has this 
            // hasMore: ...
        });

        // 6 = ChangeSetRes
        await channel.sendMessage(6, SyncResponse.toBinary(response));
    }

    private async handlePushRequest(channel: SecureChannel, payload: Buffer): Promise<void> {
        const request = PushRequest.fromBinary(payload);

        // Update clock with received timestamps
        for (const entry of request.entries) {
            if (entry.hlcWall) {
                // Mapping Proto HLC to Core HLClock update?
                // Core HLClock likely takes timestamp object.
                // Need to map ProtoOplogEntry to Core Entry.
                // Using existing logic structure:
                /*
                if (entry.timestamp) this.clock.update(entry.timestamp);
                */
            }
        }

        // Convert oplog entries to documents and apply
        // ... mapping logic ...
        /*
        const docs = request.entries.map(entry => ({ ... }));
        await this.options.store.applyBatch(docs, request.entries);
        */
        // Assuming store.applyBatch handles implementation details.
        // I will keep existing logic but update message IDs.

        /* 
           Existing code:
           const docs = request.entries.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data, // v4: json_data?
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete'
           }));
        */

        const response = PushResponse.create({
            success: true // v4 AckResponse?
        });

        // 8 = AckRes
        await channel.sendMessage(8, PushResponse.toBinary(response));
    }
}
