import { Document, HLCTimestamp } from '@entgldb/protocol';
import { IPeerStore } from './storage/interface';
import { HLClock } from './hlc/clock';

/**
 * Represents a collection of documents
 */
export class PeerCollection<T = any> {
    private clock: HLClock;

    constructor(
        private readonly store: IPeerStore,
        private readonly name: string,
        private readonly nodeId: string
    ) {
        this.clock = new HLClock(nodeId);
    }

    /**
     * Put a document in the collection
     */
    async put(key: string, data: T): Promise<void> {
        const timestamp = this.clock.now();
        const jsonData = JSON.stringify(data);
        const dataBytes = new TextEncoder().encode(jsonData);

        const doc = Document.create({
            collection: this.name,
            key,
            data: dataBytes,
            timestamp,
            tombstone: false
        });

        await this.store.putDocument(doc);
    }

    /**
     * Get a document from the collection
     */
    async get(key: string): Promise<T | null> {
        const doc = await this.store.getDocument(this.name, key);

        if (!doc || doc.tombstone) {
            return null;
        }

        const jsonData = new TextDecoder().decode(doc.data);
        return JSON.parse(jsonData) as T;
    }

    /**
     * Delete a document from the collection
     */
    async delete(key: string): Promise<void> {
        const timestamp = this.clock.now();
        await this.store.deleteDocument(this.name, key, timestamp);
    }

    /**
     * Find documents matching a predicate
     * Note: This is a simple client-side filter. For production, implement server-side queries.
     */
    async find(predicate: (doc: T) => boolean): Promise<T[]> {
        // This is a naive implementation that loads all docs
        // In production, implement proper query translation to SQL
        const results: T[] = [];

        // We'd need to add a method to IPeerStore to scan a collection
        // For now, this is a placeholder
        throw new Error('find() not yet implemented - needs store.scanCollection()');
    }
}
