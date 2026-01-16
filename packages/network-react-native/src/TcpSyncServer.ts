import TcpSocket from 'react-native-tcp-socket';
import { EventEmitter } from 'events';
import { IPeerStore } from '@entgldb/core';
import {
    SyncRequest,
    SyncResponse,
    HandshakeRequest,
    HandshakeResponse,
    PushRequest,
    PushResponse,
} from '@entgldb/protocol';
import { Buffer } from 'buffer';

export interface TcpSyncServerOptions {
    store: IPeerStore;
    nodeId: string;
    port: number;
    authToken?: string;
}

/**
 * TCP Sync Server for React Native
 */
export class TcpSyncServer extends EventEmitter {
    private server: any = null;
    private clients = new Set<any>();

    constructor(private readonly options: TcpSyncServerOptions) {
        super();
    }

    start(): void {
        this.server = TcpSocket.createServer((socket: any) => {
            this.handleConnection(socket);
        });

        this.server.listen({ port: this.options.port, host: '0.0.0.0' }, () => {
            console.log(`[EntglDb] TCP server listening on port ${this.options.port}`);
        });

        this.server.on('error', (err: Error) => {
            console.error('[EntglDb] TCP server error:', err);
        });
    }

    stop(): void {
        if (this.server) {
            this.clients.forEach(client => client.destroy());
            this.clients.clear();
            this.server.close();
            this.server = null;
        }
    }

    private handleConnection(socket: any): void {
        console.log('[EntglDb] New connection');
        this.clients.add(socket);

        let buffer = Buffer.alloc(0);

        socket.on('data', (data: string | Buffer) => {
            // Handle data which might be string or Buffer in RN
            // @ts-ignore
            const chunk = Buffer.isBuffer(data) ? (data as unknown as Buffer) : Buffer.from(data as any);
            buffer = Buffer.concat([buffer, chunk]);
            buffer = this.processBuffer(socket, buffer);
        });

        socket.on('close', () => {
            console.log('[EntglDb] Connection closed');
            this.clients.delete(socket);
        });

        socket.on('error', (err: Error) => {
            console.error('[EntglDb] Socket error:', err);
            this.clients.delete(socket);
        });
    }

    private processBuffer(socket: any, buffer: Buffer): Buffer {
        while (buffer.length >= 5) {
            const length = buffer.readUInt32BE(0);
            if (buffer.length < 4 + length) {
                break;
            }

            const messageType = buffer.readUInt8(4);
            const payload = buffer.slice(5, 4 + length);
            buffer = buffer.slice(4 + length) as unknown as Buffer;

            this.handleMessage(socket, messageType, payload as unknown as Buffer);
        }

        return buffer as unknown as Buffer;
    }

    private async handleMessage(socket: any, messageType: number, payload: Buffer): Promise<void> {
        try {
            switch (messageType) {
                case 1: // Handshake
                    await this.handleHandshake(socket, payload);
                    break;
                case 2: // Sync
                    await this.handleSync(socket, payload);
                    break;
                case 3: // Push
                    await this.handlePush(socket, payload);
                    break;
                default:
                    console.error(`[EntglDb] Unknown message type: ${messageType}`);
            }
        } catch (error: any) {
            console.error('[EntglDb] Error handling message:', error);
        }
    }

    private async handleHandshake(socket: any, payload: Buffer): Promise<void> {
        const request = HandshakeRequest.fromBinary(new Uint8Array(payload));

        if (this.options.authToken && request.authToken !== this.options.authToken) {
            const response = HandshakeResponse.create({
                accepted: false,
                errorMessage: 'Invalid auth token',
            });
            this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
            socket.destroy();
            return;
        }

        const response = HandshakeResponse.create({
            accepted: true,
            serverNodeId: this.options.nodeId,
            errorMessage: 'Connected',
        });

        this.sendMessage(socket, 1, HandshakeResponse.toBinary(response));
    }

    private async handleSync(socket: any, payload: Buffer): Promise<void> {
        const request = SyncRequest.fromBinary(new Uint8Array(payload));
        // since is optional, handle undefined
        const sinceTimestamp = request.since!;

        const entries = await this.options.store.getOplogAfter(sinceTimestamp, 100);

        const response = SyncResponse.create({
            entries,
            hasMore: entries.length >= 100,
        });

        this.sendMessage(socket, 2, SyncResponse.toBinary(response));
    }

    private async handlePush(socket: any, payload: Buffer): Promise<void> {
        const request = PushRequest.fromBinary(new Uint8Array(payload));

        const docs = request.entries.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data,
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete',
        }));

        await this.options.store.applyBatch(docs, request.entries);

        const response = PushResponse.create({
            accepted: true,
            appliedCount: request.entries.length,
            conflicts: [],
        });

        this.sendMessage(socket, 3, PushResponse.toBinary(response));
    }

    private sendMessage(socket: any, messageType: number, payload: Uint8Array): void {
        const length = 1 + payload.length;
        const buffer = Buffer.alloc(4 + length);
        buffer.writeUInt32BE(length, 0);
        buffer.writeUInt8(messageType, 4);
        Buffer.from(payload).copy(buffer, 5);
        socket.write(buffer as unknown as Buffer);
    }
}
