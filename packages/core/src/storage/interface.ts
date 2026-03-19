import { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';
import { PeerNode } from '../network/PeerNode';
export type { OplogEntry };

/**
 * Storage interface that must be implemented by persistence adapters
 */
export interface IPeerStore {
    /**
     * Initialize the store (create tables, etc.)
     */
    initialize(): Promise<void>;

    /**
     * Get the latest timestamp in the store
     */
    getLatestTimestamp(): Promise<HLCTimestamp>;

    /**
     * Get a document by collection and key
     */
    getDocument(collection: string, key: string): Promise<Document | null>;

    /**
     * Put a document
     */
    putDocument(doc: Document): Promise<void>;

    /**
     * Delete a document (creates tombstone)
     */
    deleteDocument(collection: string, key: string, timestamp: HLCTimestamp): Promise<void>;

    /**
     * Get the current Vector Clock from the store
     */
    getVectorClock(): Promise<import('../hlc/vector-clock').VectorClock>;

    /**
     * Get oplog entries after a given timestamp
     */
    getOplogAfter(timestamp: HLCTimestamp, limit?: number): Promise<OplogEntry[]>;

    /**
     * Get oplog entries for a specific node after a given timestamp
     */
    getOplogForNodeAfter(nodeId: string, timestamp: HLCTimestamp): Promise<OplogEntry[]>;

    /**
     * Get the hash of the last entry for a specific node
     */
    getLastEntryHash(nodeId: string): Promise<string | null>;

    /**
     * Get a range of oplog entries between two hashes (inclusive end)
     */
    getChainRange(startHash: string, endHash: string): Promise<OplogEntry[]>;

    /**
     * Apply a batch of documents and oplog entries (for sync)
     */
    applyBatch(docs: Document[], oplog: OplogEntry[]): Promise<void>;

    /**
     * Get all collection names
     */
    getCollections(): Promise<string[]>;

    /**
     * Find documents matching a query node
     */
    findDocuments(collection: string, query: any /* QueryNode */): Promise<Document[]>;

    /**
     * Get all persistent remote peers
     */
    getRemotePeers(): Promise<PeerNode[]>;

    /**
     * Save a remote peer configuration
     */
    saveRemotePeer(peer: PeerNode): Promise<void>;

    /**
     * Remove a remote peer configuration
     */
    removeRemotePeer(nodeId: string): Promise<void>;

    /**
     * Close the store
     */
    close(): Promise<void>;
}
