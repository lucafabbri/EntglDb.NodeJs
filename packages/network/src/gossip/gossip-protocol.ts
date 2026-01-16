import { IPeerStore } from '@entgldb/core';
import { OplogEntry, HLCTimestamp, PushRequest } from '@entgldb/protocol';
import { TcpSyncClient } from '../tcp-client';
import { PeerInfo } from '../sync-orchestrator';

export interface GossipOptions {
    store: IPeerStore;
    nodeId: string;
    authToken?: string;
    maxHops?: number;  // Maximum gossip hops (TTL)
    gossipDelay?: number;  // Delay before gossiping (ms)
}

interface GossipMessage {
    entries: OplogEntry[];
    sourceNodeId: string;
    hops: number;
    messageId: string;
}

/**
 * Gossip protocol for automatic change propagation
 */
export class GossipProtocol {
    private peers: PeerInfo[] = [];
    private seenMessages = new Map<string, number>();  // messageId -> timestamp
    private gossipQueue: GossipMessage[] = [];
    private processing = false;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(private readonly options: GossipOptions) {
        // Cleanup seen messages every minute
        this.cleanupTimer = setInterval(() => {
            this.cleanupSeenMessages();
        }, 60000);
    }

    /**
     * Add a peer to gossip to
     */
    addPeer(peer: PeerInfo): void {
        const exists = this.peers.some(p => p.nodeId === peer.nodeId);
        if (!exists) {
            this.peers.push(peer);
        }
    }

    /**
     * Remove a peer
     */
    removePeer(nodeId: string): void {
        this.peers = this.peers.filter(p => p.nodeId !== nodeId);
    }

    /**
     * Propagate local changes to peers via gossip
     */
    async propagateChanges(entries: OplogEntry[]): Promise<void> {
        if (entries.length === 0) return;

        const messageId = this.generateMessageId();
        const message: GossipMessage = {
            entries,
            sourceNodeId: this.options.nodeId,
            hops: 0,
            messageId
        };

        // Mark as seen
        this.seenMessages.set(messageId, Date.now());

        // Add to queue
        this.gossipQueue.push(message);

        // Process queue
        this.processQueue();
    }

    /**
     * Handle incoming gossip message
     */
    async handleGossipMessage(
        entries: OplogEntry[],
        sourceNodeId: string,
        messageId: string,
        hops: number
    ): Promise<void> {
        // Check if we've seen this message
        if (this.seenMessages.has(messageId)) {
            return;
        }

        // Check max hops (TTL)
        const maxHops = this.options.maxHops || 3;
        if (hops >= maxHops) {
            return;
        }

        // Mark as seen
        this.seenMessages.set(messageId, Date.now());

        // Apply changes locally
        const docs = entries.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data,
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete'
        }));

        await this.options.store.applyBatch(docs, entries);

        console.log(`[Gossip] Received ${entries.length} changes from ${sourceNodeId} (hop ${hops})`);

        // Re-gossip to our peers
        const message: GossipMessage = {
            entries,
            sourceNodeId,
            hops: hops + 1,
            messageId
        };

        this.gossipQueue.push(message);
        this.processQueue();
    }

    /**
     * Process gossip queue
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.gossipQueue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.gossipQueue.length > 0) {
            const message = this.gossipQueue.shift()!;

            // Delay to prevent network storms
            const delay = this.options.gossipDelay || 100;
            await this.sleep(delay);

            // Send to all peers except source
            const promises = this.peers
                .filter(p => p.nodeId !== message.sourceNodeId)
                .map(peer => this.gossipToPeer(peer, message));

            await Promise.allSettled(promises);
        }

        this.processing = false;
    }

    /**
     * Gossip message to a specific peer
     */
    private async gossipToPeer(peer: PeerInfo, message: GossipMessage): Promise<void> {
        const client = new TcpSyncClient({
            nodeId: this.options.nodeId,
            host: peer.host,
            port: peer.port,
            authToken: this.options.authToken
        });

        try {
            await client.connect();

            // Use push request to send changes
            const request = PushRequest.create({
                entries: message.entries
            });

            // Send via push (using message type 3)
            // Note: We'd need to extend TcpSyncClient to support custom push
            // For now, we'll use the existing infrastructure

            client.disconnect();
        } catch (error: any) {
            console.error(`[Gossip] Failed to gossip to ${peer.nodeId}:`, error.message);
        }
    }

    /**
     * Cleanup old seen messages (older than 5 minutes)
     */
    private cleanupSeenMessages(): void {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

        for (const [messageId, timestamp] of this.seenMessages.entries()) {
            if (timestamp < fiveMinutesAgo) {
                this.seenMessages.delete(messageId);
            }
        }
    }

    /**
     * Generate unique message ID
     */
    private generateMessageId(): string {
        return `${this.options.nodeId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Stop gossip protocol
     */
    stop(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        this.seenMessages.clear();
        this.gossipQueue = [];
    }
}
