import { IPeerStore } from './storage/interface';
import { PeerCollection } from './collection';

/**
 * The main database instance
 */
export class PeerDatabase {
    private initialized = false;

    constructor(
        private readonly store: IPeerStore,
        private readonly nodeId: string
    ) { }

    /**
     * Initialize the database
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.store.initialize();
        this.initialized = true;
    }

    /**
     * Get a collection (creates if doesn't exist)
     */
    collection<T = any>(name: string): PeerCollection<T> {
        if (!this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }

        return new PeerCollection<T>(this.store, name, this.nodeId);
    }

    /**
     * Get all collection names
     */
    async getCollections(): Promise<string[]> {
        if (!this.initialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }

        return this.store.getCollections();
    }

    /**
     * Close the database
     */
    async close(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        await this.store.close();
        this.initialized = false;
    }
}
