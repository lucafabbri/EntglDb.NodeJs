import { IPeerStore, HLClock } from '@entgldb/core';
import { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';
import { open } from 'react-native-quick-sqlite';

/**
 * React Native SQLite implementation using quick-sqlite
 */
export class ReactNativeSqliteStore implements IPeerStore {
    private db: any;
    private initialized = false;

    constructor(dbName: string) {
        this.db = open({ name: dbName });
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Create tables
        this.db.execute(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        logical_time TEXT NOT NULL,
        counter INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        tombstone INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection, key)
      );

      CREATE INDEX IF NOT EXISTS idx_documents_timestamp 
        ON documents(logical_time, counter, node_id);

      CREATE TABLE IF NOT EXISTS oplog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        data TEXT,
        operation TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        logical_time TEXT NOT NULL,
        counter INTEGER NOT NULL,
        node_id TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_oplog_timestamp 
        ON oplog(logical_time, counter, node_id);
    `);

        this.initialized = true;
    }

    async getLatestTimestamp(): Promise<HLCTimestamp> {
        const result = this.db.execute(
            'SELECT logical_time, counter, node_id FROM documents ORDER BY logical_time DESC, counter DESC LIMIT 1'
        );

        if (result.rows && result.rows.length > 0) {
            const row = result.rows.item(0);
            return HLCTimestamp.create({
                logicalTime: row.logical_time,
                counter: row.counter,
                nodeId: row.node_id
            });
        }

        return HLCTimestamp.create({
            logicalTime: '0',
            counter: 0,
            nodeId: ''
        });
    }

    async getDocument(collection: string, key: string): Promise<Document | null> {
        const result = this.db.execute(
            'SELECT data, logical_time, counter, node_id, tombstone FROM documents WHERE collection = ? AND key = ?',
            [collection, key]
        );

        if (!result.rows || result.rows.length === 0) return null;

        const row = result.rows.item(0);
        const dataBytes = new TextEncoder().encode(row.data);

        return Document.create({
            collection,
            key,
            data: dataBytes,
            timestamp: HLCTimestamp.create({
                logicalTime: row.logical_time,
                counter: row.counter,
                nodeId: row.node_id
            }),
            tombstone: row.tombstone === 1
        });
    }

    async putDocument(doc: Document): Promise<void> {
        const dataStr = new TextDecoder().decode(doc.data);
        const timestampStr = HLClock.toString(doc.timestamp!);

        this.db.execute('BEGIN TRANSACTION');

        try {
            // Upsert document
            this.db.execute(
                `INSERT OR REPLACE INTO documents (collection, key, data, timestamp, logical_time, counter, node_id, tombstone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    doc.collection,
                    doc.key,
                    dataStr,
                    timestampStr,
                    doc.timestamp!.logicalTime,
                    doc.timestamp!.counter,
                    doc.timestamp!.nodeId,
                    doc.tombstone ? 1 : 0
                ]
            );

            // Add collection
            this.db.execute('INSERT OR IGNORE INTO collections (name) VALUES (?)', [doc.collection]);

            // Add to oplog
            this.db.execute(
                `INSERT INTO oplog (collection, key, data, operation, timestamp, logical_time, counter, node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    doc.collection,
                    doc.key,
                    dataStr,
                    doc.tombstone ? 'delete' : 'put',
                    timestampStr,
                    doc.timestamp!.logicalTime,
                    doc.timestamp!.counter,
                    doc.timestamp!.nodeId
                ]
            );

            this.db.execute('COMMIT');
        } catch (error) {
            this.db.execute('ROLLBACK');
            throw error;
        }
    }

    async deleteDocument(collection: string, key: string, timestamp: HLCTimestamp): Promise<void> {
        const tombstone = Document.create({
            collection,
            key,
            data: new Uint8Array(0),
            timestamp,
            tombstone: true
        });

        await this.putDocument(tombstone);
    }

    async getOplogAfter(timestamp: HLCTimestamp, limit = 100): Promise<OplogEntry[]> {
        const result = this.db.execute(
            `SELECT collection, key, data, operation, logical_time, counter, node_id
       FROM oplog
       WHERE (logical_time > ?) 
          OR (logical_time = ? AND counter > ?)
          OR (logical_time = ? AND counter = ? AND node_id > ?)
       ORDER BY logical_time, counter, node_id
       LIMIT ?`,
            [
                timestamp.logicalTime,
                timestamp.logicalTime,
                timestamp.counter,
                timestamp.logicalTime,
                timestamp.counter,
                timestamp.nodeId,
                limit
            ]
        );

        const entries: OplogEntry[] = [];
        if (result.rows) {
            for (let i = 0; i < result.rows.length; i++) {
                const row = result.rows.item(i);
                const dataBytes = row.data ? new TextEncoder().encode(row.data) : new Uint8Array(0);

                entries.push(OplogEntry.create({
                    collection: row.collection,
                    key: row.key,
                    data: dataBytes,
                    timestamp: HLCTimestamp.create({
                        logicalTime: row.logical_time,
                        counter: row.counter,
                        nodeId: row.node_id
                    }),
                    operation: row.operation
                }));
            }
        }

        return entries;
    }

    async applyBatch(docs: Document[], oplog: OplogEntry[]): Promise<void> {
        this.db.execute('BEGIN TRANSACTION');

        try {
            for (const doc of docs) {
                await this.putDocument(doc);
            }
            this.db.execute('COMMIT');
        } catch (error) {
            this.db.execute('ROLLBACK');
            throw error;
        }
    }

    async getCollections(): Promise<string[]> {
        const result = this.db.execute('SELECT name FROM collections ORDER BY name');

        const collections: string[] = [];
        if (result.rows) {
            for (let i = 0; i < result.rows.length; i++) {
                collections.push(result.rows.item(i).name);
            }
        }

        return collections;
    }

    async close(): Promise<void> {
        this.db.close();
        this.initialized = false;
    }
}
