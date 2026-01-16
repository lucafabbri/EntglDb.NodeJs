import { IPeerStore, HLClock } from '@entgldb/core';
import { TcpSyncClient } from './tcp-client';
import { HLCTimestamp } from '@entgldb/protocol';

export interface PeerInfo {
    nodeId: string;
    host: string;
    port: number;
}

export interface SyncOrchestratorOptions {
    store: IPeerStore;
    nodeId: string;
    authToken?: string;
    syncIntervalMs?: number;
}

/**
 * Orchestrates synchronization with discovered peers
 */
export class SyncOrchestrator {
    private peers: PeerInfo[] = [];
    private syncTimer: NodeJS.Timeout | null = null;
    private clock: HLClock;
    private running = false;

    constructor(private readonly options: SyncOrchestratorOptions) {
        this.clock = new HLClock(options.nodeId);
    }

    /**
     * Add a peer to sync with
     */
    addPeer(peer: PeerInfo): void {
        const exists = this.peers.some(p => p.nodeId === peer.nodeId);
        if (!exists) {
            this.peers.push(peer);
            console.log(`[SyncOrchestrator] Added peer: ${peer.nodeId} at ${peer.host}:${peer.port}`);
        }
    }

    /**
     * Remove a peer
     */
    removePeer(nodeId: string): void {
        this.peers = this.peers.filter(p => p.nodeId !== nodeId);
        console.log(`[SyncOrchestrator] Removed peer: ${nodeId}`);
    }

    /**
     * Start periodic sync
     */
    start(): void {
        if (this.running) return;

        this.running = true;
        const intervalMs = this.options.syncIntervalMs || 5000;

        this.syncTimer = setInterval(() => {
            this.syncWithAllPeers();
        }, intervalMs);

        console.log(`[SyncOrchestrator] Started with ${intervalMs}ms interval`);
    }

    /**
     * Stop sync
     */
    stop(): void {
        if (!this.running) return;

        this.running = false;

        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }

        console.log('[SyncOrchestrator] Stopped');
    }

    /**
     * Manually trigger sync with all peers
     */
    async syncWithAllPeers(): Promise<void> {
        const syncPromises = this.peers.map(peer =>
            this.syncWithPeer(peer).catch(error => {
                console.error(`[SyncOrchestrator] Sync failed with ${peer.nodeId}:`, error.message);
            })
        );

        await Promise.all(syncPromises);
    }

    /**
     * Sync with a specific peer
     */
    private async syncWithPeer(peer: PeerInfo): Promise<void> {
        const client = new TcpSyncClient({
            nodeId: this.options.nodeId,
            host: peer.host,
            port: peer.port,
            authToken: this.options.authToken
        });

        try {
            await client.connect();

            // Get our latest timestamp
            const since = await this.options.store.getLatestTimestamp();

            // Pull changes
            let hasMore = true;
            let pulledCount = 0;

            while (hasMore) {
                const response = await client.pullChanges(since, 100);

                if (response.entries.length > 0) {
                    // Update clock
                    for (const entry of response.entries) {
                        this.clock.update(entry.timestamp!);
                    }

                    // Convert to documents and apply
                    const docs = response.entries.map(entry => ({
                        collection: entry.collection,
                        key: entry.key,
                        data: entry.data,
                        timestamp: entry.timestamp!,
                        tombstone: entry.operation === 'delete'
                    }));

                    await this.options.store.applyBatch(docs, response.entries);
                    pulledCount += response.entries.length;
                }

                hasMore = response.hasMore;
            }

            if (pulledCount > 0) {
                console.log(`[SyncOrchestrator] Pulled ${pulledCount} changes from ${peer.nodeId}`);
            }

            client.disconnect();
        } catch (error) {
            client.disconnect();
            throw error;
        }
    }
}
