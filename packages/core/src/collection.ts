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
    /**
     * Find documents matching a query object
     * @param query The query object (e.g. { name: "Fabio" })
     * @param options Query options including naming strategy
     */
    async find(query: any, options?: { namingStrategy?: (prop: string) => string }): Promise<T[]> {
        const { ObjectToQueryNodeTranslator } = require('./query/translator');
        const queryNode = ObjectToQueryNodeTranslator.translate(query, options);

        // If no query, return all? or support empty query?
        // If queryNode is null (empty query), we might want to scan all.
        // For now let's pass null to store and let it decide (scan all).

        const docs = await this.store.findDocuments(this.name, queryNode);

        return docs.map(doc => {
            const jsonData = new TextDecoder().decode(doc.data);
            return JSON.parse(jsonData) as T;
        });
    }
}
