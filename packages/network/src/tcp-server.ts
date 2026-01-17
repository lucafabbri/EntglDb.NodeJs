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
    private connectionCiphers = new WeakMap<net.Socket, CipherState>();

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
    }

    private async handleConnection(socket: net.Socket): Promise<void> {
        console.log(`[EntglDb] New connection from ${socket.remoteAddress}`);

        // Perform secure handshake if service provided
        if (this.options.handshakeService) {
            try {
                const cipherState = await this.options.handshakeService.handshake(
                    socket,
                    false, // isInitiator (server is responder)
                    this.options.nodeId
                );
                if (cipherState) {
                    this.connectionCiphers.set(socket, cipherState);
                }
            } catch (error) {
                console.error('[EntglDb] Security handshake failed:', error);
                socket.end();
                return;
            }
        }

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

                let messageData = buffer.subarray(4, 4 + messageLength);
                buffer = buffer.subarray(4 + messageLength);

                // Decrypt if cipher state exists for this connection
                const cipherState = this.connectionCiphers.get(socket);
                if (cipherState) {
                    const ivLen = messageData[0];
                    const iv = messageData.subarray(1, 1 + ivLen);
                    const tagLen = messageData[1 + ivLen];
                    const tag = messageData.subarray(2 + ivLen, 2 + ivLen + tagLen);
                    const ciphertext = messageData.subarray(2 + ivLen + tagLen);

                    messageData = CryptoHelper.decrypt(ciphertext, iv, tag, cipherState.decryptKey);
                }

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

        // Validate auth token using authenticator or simple token check
        if (this.options.authenticator) {
            const valid = await this.options.authenticator.validate(request.nodeId, request.authToken);
            if (!valid) {
                const response = HandshakeResponse.create({
                    accepted: false,
                    serverNodeId: this.options.nodeId,
                    protocolVersion: PROTOCOL_VERSION,
                    enabledFeatures: [],
                    errorMessage: 'Authentication failed'
                });

                this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
                socket.end();
                return;
            }
        } else if (this.options.authToken && request.authToken !== this.options.authToken) {
            const response = HandshakeResponse.create({
                accepted: false,
                serverNodeId: this.options.nodeId,
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
                serverNodeId: this.options.nodeId,
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
            serverNodeId: this.options.nodeId,
            protocolVersion: PROTOCOL_VERSION,
            enabledFeatures: request.supportedFeatures,
            errorMessage: ''
        });

        this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
    }

    private async handleSyncRequest(socket: net.Socket, payload: Buffer): Promise<void> {
        const request = SyncRequest.fromBinary(payload);
        const batchSize = request.batchSize || 100;

        const entries = await this.options.store.getOplogAfter(request.since!, batchSize);
        const latest = await this.options.store.getLatestTimestamp();

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

        await this.options.store.applyBatch(docs, request.entries);

        const response = PushResponse.create({
            accepted: true,
            appliedCount: request.entries.length,
            conflicts: []
        });

        this.sendMessage(socket, 3, PushResponse.toBinary(response));
    }

    private sendMessage(socket: net.Socket, messageType: number, payload: Uint8Array): void {
        const typeBuffer = Buffer.from([messageType]);
        let messagePayload = Buffer.concat([typeBuffer, Buffer.from(payload)]);

        // Encrypt if cipher state exists for this connection
        const cipherState = this.connectionCiphers.get(socket);
        if (cipherState) {
            const { ciphertext, iv, tag } = CryptoHelper.encrypt(messagePayload, cipherState.encryptKey);
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

        socket.write(message);
    }
}
