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

/**
 * TCP-based sync server
 */
export class TcpSyncServer {
    private server: net.Server | null = null;
    private clock: HLClock;

    constructor(
        private readonly store: IPeerStore,
        private readonly nodeId: string,
        private readonly port: number,
        private readonly authToken: string = ''
    ) {
        this.clock = new HLClock(nodeId);
    }

    /**
     * Start the server
     */
    start(): void {
        this.server = net.createServer((socket) => {
            this.handleConnection(socket);
        });

        this.server.listen(this.port, () => {
            console.log(`[EntglDb] Sync server listening on port ${this.port}`);
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
    }

    private async handleConnection(socket: net.Socket): Promise<void> {
        console.log(`[EntglDb] New connection from ${socket.remoteAddress}`);

        let buffer = Buffer.alloc(0);

        socket.on('data', async (data) => {
            buffer = Buffer.concat([buffer, data]);

            // Simple message framing: 4 bytes length + payload
            while (buffer.length >= 4) {
                const messageLength = buffer.readUInt32BE(0);

                if (buffer.length < 4 + messageLength) {
                    // Wait for more data
                    break;
                }

                const messageData = buffer.subarray(4, 4 + messageLength);
                buffer = buffer.subarray(4 + messageLength);

                try {
                    await this.handleMessage(socket, messageData);
                } catch (error) {
                    console.error('[EntglDb] Error handling message:', error);
                    socket.end();
                }
            }
        });

        socket.on('error', (error) => {
            console.error('[EntglDb] Socket error:', error);
        });

        socket.on('close', () => {
            console.log('[EntglDb] Connection closed');
        });
    }

    private async handleMessage(socket: net.Socket, data: Buffer): Promise<void> {
        // Parse message type (first byte)
        const messageType = data[0];
        const payload = data.subarray(1);

        switch (messageType) {
            case 1: // Handshake
                await this.handleHandshake(socket, payload);
                break;
            case 2: // Sync request
                await this.handleSyncRequest(socket, payload);
                break;
            case 3: // Push request
                await this.handlePushRequest(socket, payload);
                break;
            default:
                console.error('[EntglDb] Unknown message type:', messageType);
        }
    }

    private async handleHandshake(socket: net.Socket, payload: Buffer): Promise<void> {
        const request = HandshakeRequest.fromBinary(payload);

        // Validate auth token
        if (this.authToken && request.authToken !== this.authToken) {
            const response = HandshakeResponse.create({
                accepted: false,
                serverNodeId: this.nodeId,
                protocolVersion: PROTOCOL_VERSION,
                enabledFeatures: [],
                errorMessage: 'Invalid auth token'
            });

            this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
            socket.end();
            return;
        }

        // Check protocol version
        if (request.protocolVersion !== PROTOCOL_VERSION) {
            const response = HandshakeResponse.create({
                accepted: false,
                serverNodeId: this.nodeId,
                protocolVersion: PROTOCOL_VERSION,
                enabledFeatures: [],
                errorMessage: `Protocol version mismatch. Expected ${PROTOCOL_VERSION}, got ${request.protocolVersion}`
            });

            this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
            socket.end();
            return;
        }

        const response = HandshakeResponse.create({
            accepted: true,
            serverNodeId: this.nodeId,
            protocolVersion: PROTOCOL_VERSION,
            enabledFeatures: request.supportedFeatures,
            errorMessage: ''
        });

        this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
    }

    private async handleSyncRequest(socket: net.Socket, payload: Buffer): Promise<void> {
        const request = SyncRequest.fromBinary(payload);
        const batchSize = request.batchSize || 100;

        const entries = await this.store.getOplogAfter(request.since!, batchSize);
        const latest = await this.store.getLatestTimestamp();

        const response = SyncResponse.create({
            entries,
            latestTimestamp: latest,
            hasMore: entries.length === batchSize
        });

        this.sendMessage(socket, 2, SyncResponse.toBinary(response));
    }

    private async handlePushRequest(socket: net.Socket, payload: Buffer): Promise<void> {
        const request = PushRequest.fromBinary(payload);

        // Update clock with received timestamps
        for (const entry of request.entries) {
            if (entry.timestamp) {
                this.clock.update(entry.timestamp);
            }
        }

        // Convert oplog entries to documents and apply
        const docs = request.entries.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data,
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete'
        }));

        await this.store.applyBatch(docs, request.entries);

        const response = PushResponse.create({
            accepted: true,
            appliedCount: request.entries.length,
            conflicts: []
        });

        this.sendMessage(socket, 3, PushResponse.toBinary(response));
    }

    private sendMessage(socket: net.Socket, messageType: number, payload: Uint8Array): void {
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(1 + payload.length);

        const typeBuffer = Buffer.from([messageType]);
        const message = Buffer.concat([length, typeBuffer, Buffer.from(payload)]);

        socket.write(message);
    }
}
