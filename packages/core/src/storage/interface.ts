import { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';
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
     * Get oplog entries after a given timestamp
     */
    getOplogAfter(timestamp: HLCTimestamp, limit?: number): Promise<OplogEntry[]>;

    /**
     * Apply a batch of documents and oplog entries (for sync)
     */
    applyBatch(docs: Document[], oplog: OplogEntry[]): Promise<void>;

    /**
     * Get all collection names
     */
    getCollections(): Promise<string[]>;

    /**
     * Close the store
     */
    close(): Promise<void>;
}
