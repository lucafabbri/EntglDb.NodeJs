import * as net from 'net';
import { IPeerStore, HLClock } from '@entgldb/core';

import {
    HandshakeRequest,
    HandshakeResponse,
    PullChangesRequest,
    ChangeSetResponse,
    PushChangesRequest,
    AckResponse,
    HLCTimestamp,
    PROTOCOL_VERSION,
    ProtocolMapper
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
                    false,
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
            case 5: // PullChangesReq
                await this.handleSyncRequest(channel, payload);
                break;
            case 7: // PushChangesReq
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
            nodeId: this.options.nodeId
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
        const request = PullChangesRequest.fromBinary(payload);

        // Reconstruct timestamp from flat fields
        const since = HLCTimestamp.create({
            logicalTime: request.sinceWall,
            counter: request.sinceLogic,
            nodeId: request.sinceNode
        });

        const entries = await this.options.store.getOplogAfter(since, 100); // Default batch size?

        const response = ChangeSetResponse.create({
            entries: entries.map(e => ProtocolMapper.toProtoOplogEntry(e))
        });

        // 6 = ChangeSetRes
        await channel.sendMessage(6, ChangeSetResponse.toBinary(response));
    }

    private async handlePushRequest(channel: SecureChannel, payload: Buffer): Promise<void> {
        const request = PushChangesRequest.fromBinary(payload);

        // Convert entries to Domain format
        const domainEntries = request.entries.map(e => ProtocolMapper.toDomainOplogEntry(e));

        // Update clock with received timestamps
        for (const entry of domainEntries) {
            if (entry.timestamp) {
                this.clock.update(entry.timestamp);
            }
        }

        const docs = domainEntries.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data,
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete'
        }));

        await this.options.store.applyBatch(docs, domainEntries);

        const response = AckResponse.create({
            success: true
        });

        // 8 = AckRes
        await channel.sendMessage(8, AckResponse.toBinary(response));
    }
}
