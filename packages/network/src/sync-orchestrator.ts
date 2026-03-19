import { IPeerStore, HLClock, VectorClock, CausalityRelation } from '@entgldb/core';
import { TcpSyncClient } from './tcp-client';
import { HLCTimestamp, ProtocolMapper, OplogEntry } from '@entgldb/protocol';

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
        // Pick random peers like in .NET? For now simple loop
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
            // Handshake is done automatically in connect() if configured, but here we assume it's part of connect flow logic in TcpSyncClient which calls handshake()

            // 1. Exchange Vector Clocks
            const remoteVCResponse = await client.getVectorClock();
            const remoteEntries = remoteVCResponse.entries.map(e => ({
                nodeId: e.nodeId,
                timestamp: HLCTimestamp.create({
                    logicalTime: e.hlcWall,
                    counter: e.hlcLogic,
                    nodeId: e.nodeId
                })
            }));

            const remoteVCMap = new Map<string, HLCTimestamp>();
            for (const entry of remoteEntries) {
                remoteVCMap.set(entry.nodeId, entry.timestamp);
            }
            const remoteVC = new VectorClock(remoteVCMap);

            const localVC = await this.options.store.getVectorClock();

            // 2. Logic: Compare and Sync
            // PULL: Nodes where remote is ahead
            const nodesToPull = localVC.getNodesWithUpdates(remoteVC);

            for (const nodeId of nodesToPull) {
                const localTs = localVC.getTimestamp(nodeId) || HLCTimestamp.create({
                    logicalTime: '0',
                    counter: 0,
                    nodeId: nodeId
                });

                // Pull changes for this node
                const response = await client.pullChanges(localTs, 100);

                if (response.entries.length > 0) {
                    const domainEntries = response.entries.map(e => ProtocolMapper.toDomainOplogEntry(e));
                    await this.processInboundBatch(client, peer.nodeId, domainEntries);
                }
            }

            // PUSH: Nodes where local is ahead
            const nodesToPush = localVC.getNodesToPush(remoteVC);

            for (const nodeId of nodesToPush) {
                const remoteTs = remoteVC.getTimestamp(nodeId) || HLCTimestamp.create({
                    logicalTime: '0',
                    counter: 0,
                    nodeId: nodeId
                });

                const changes = await this.options.store.getOplogForNodeAfter(nodeId, remoteTs);
                if (changes.length > 0) {
                    await client.pushChanges(changes);
                }
            }

            client.disconnect();
        } catch (error) {
            client.disconnect();
            throw error;
        }
    }

    private async processInboundBatch(client: TcpSyncClient, peerNodeId: string, changes: OplogEntry[]): Promise<void> {
        // Validation and Gap Recovery
        if (changes.length === 0) return;

        // Group by NodeId (though usually we pull for one node)
        // Sort by timestamp
        // Verify hash chain

        // Simple sequential verification 
        for (let i = 0; i < changes.length; i++) {
            const entry = changes[i];

            // Check Hash if we implemented verification logic in OplogEntry or util
            // For now assuming internal integrity of the entry structure itself is OK

            if (i > 0) {
                const prev = changes[i - 1];
                if (entry.previousHash !== prev.hash) {
                    throw new Error(`Chain Broken in Batch for Node ${entry.timestamp!.nodeId}`);
                }
            }
        }

        // Check linkage with Local State
        const firstEntry = changes[0];
        const authorNodeId = firstEntry.timestamp!.nodeId;
        const localHeadHash = await this.options.store.getLastEntryHash(authorNodeId);

        if (localHeadHash && firstEntry.previousHash !== localHeadHash) {
            console.warn(`Gap Detected for Node ${authorNodeId}. Local Head: ${localHeadHash}, Remote Prev: ${firstEntry.previousHash}. Initiating Recovery.`);

            // Gap Recovery
            const response = await client.getChainRange(localHeadHash, firstEntry.previousHash!);
            const missingChain = response.entries.map(e => ProtocolMapper.toDomainOplogEntry(e));

            if (missingChain.length > 0) {
                // Apply missing chain first
                await this.applyChanges(missingChain);
            }
        }

        // Apply original batch
        await this.applyChanges(changes);
    }

    private async applyChanges(changes: OplogEntry[]): Promise<void> {
        const docs = changes.map(entry => ({
            collection: entry.collection,
            key: entry.key,
            data: entry.data,
            timestamp: entry.timestamp!,
            tombstone: entry.operation === 'delete'
        }));

        await this.options.store.applyBatch(docs, changes);

        // Update local clock (in memory) if needed, but store handles persistence
        for (const entry of changes) {
            if (entry.timestamp) {
                this.clock.update(entry.timestamp);
            }
        }
    }
}

