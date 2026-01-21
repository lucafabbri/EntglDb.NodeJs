import Database from 'better-sqlite3';
import { IPeerStore, HLClock, PeerNode, PeerType } from '@entgldb/core';
import { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';

/**
 * SQLite implementation of IPeerStore
 */
export class SqlitePeerStore implements IPeerStore {
    private db: Database.Database;
    private initialized = false;

    constructor(filename: string) {
        this.db = new Database(filename);
        this.db.pragma('journal_mode = WAL');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Create tables
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        data BLOB NOT NULL,
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
        data BLOB,
        operation TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        logical_time TEXT NOT NULL,
        counter INTEGER NOT NULL,
        node_id TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_oplog_timestamp 
        ON oplog(logical_time, counter, node_id);

      CREATE TABLE IF NOT EXISTS remote_peers (
        node_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        type INTEGER NOT NULL,
        oauth2_json TEXT,
        is_enabled INTEGER NOT NULL
      );
    `);

        this.initialized = true;
    }

    async getLatestTimestamp(): Promise<HLCTimestamp> {
        const row = this.db.prepare(`
      SELECT logical_time, counter, node_id 
      FROM documents 
      ORDER BY logical_time DESC, counter DESC 
      LIMIT 1
    `).get() as { logical_time: string; counter: number; node_id: string } | undefined;

        if (!row) {
            return HLCTimestamp.create({
                logicalTime: '0',
                counter: 0,
                nodeId: ''
            });
        }

        return HLCTimestamp.create({
            logicalTime: row.logical_time,
            counter: row.counter,
            nodeId: row.node_id
        });
    }

    async getDocument(collection: string, key: string): Promise<Document | null> {
        const row = this.db.prepare(`
      SELECT data, logical_time, counter, node_id, tombstone
      FROM documents
      WHERE collection = ? AND key = ?
    `).get(collection, key) as {
            data: Buffer;
            logical_time: string;
            counter: number;
            node_id: string;
            tombstone: number;
        } | undefined;

        if (!row) return null;

        return Document.create({
            collection,
            key,
            data: new Uint8Array(row.data),
            timestamp: HLCTimestamp.create({
                logicalTime: row.logical_time,
                counter: row.counter,
                nodeId: row.node_id
            }),
            tombstone: row.tombstone === 1
        });
    }

    async putDocument(doc: Document): Promise<void> {
        const tx = this.db.transaction(() => {
            // Upsert document
            this.db.prepare(`
        INSERT INTO documents (collection, key, data, timestamp, logical_time, counter, node_id, tombstone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(collection, key) DO UPDATE SET
          data = excluded.data,
          timestamp = excluded.timestamp,
          logical_time = excluded.logical_time,
          counter = excluded.counter,
          node_id = excluded.node_id,
          tombstone = excluded.tombstone
      `).run(
                doc.collection,
                doc.key,
                Buffer.from(doc.data),
                HLClock.toString(doc.timestamp!),
                doc.timestamp!.logicalTime,
                doc.timestamp!.counter,
                doc.timestamp!.nodeId,
                doc.tombstone ? 1 : 0
            );

            // Add collection if not exists
            this.db.prepare(`
        INSERT OR IGNORE INTO collections (name) VALUES (?)
      `).run(doc.collection);

            // Add to oplog
            this.db.prepare(`
        INSERT INTO oplog (collection, key, data, operation, timestamp, logical_time, counter, node_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                doc.collection,
                doc.key,
                Buffer.from(doc.data),
                doc.tombstone ? 'delete' : 'put',
                HLClock.toString(doc.timestamp!),
                doc.timestamp!.logicalTime,
                doc.timestamp!.counter,
                doc.timestamp!.nodeId
            );
        });

        tx();
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
        const rows = this.db.prepare(`
      SELECT collection, key, data, operation, logical_time, counter, node_id
      FROM oplog
      WHERE (logical_time > ?) 
         OR (logical_time = ? AND counter > ?)
         OR (logical_time = ? AND counter = ? AND node_id > ?)
      ORDER BY logical_time, counter, node_id
      LIMIT ?
    `).all(
            timestamp.logicalTime,
            timestamp.logicalTime,
            timestamp.counter,
            timestamp.logicalTime,
            timestamp.counter,
            timestamp.nodeId,
            limit
        ) as Array<{
            collection: string;
            key: string;
            data: Buffer | null;
            operation: string;
            logical_time: string;
            counter: number;
            node_id: string;
        }>;

        return rows.map(row => OplogEntry.create({
            collection: row.collection,
            key: row.key,
            data: row.data ? new Uint8Array(row.data) : new Uint8Array(0),
            timestamp: HLCTimestamp.create({
                logicalTime: row.logical_time,
                counter: row.counter,
                nodeId: row.node_id
            }),
            operation: row.operation
        }));
    }

    async applyBatch(docs: Document[], oplog: OplogEntry[]): Promise<void> {
        const tx = this.db.transaction(() => {
            for (const doc of docs) {
                this.putDocument(doc);
            }
        });

        tx();
    }

    async getCollections(): Promise<string[]> {
        const rows = this.db.prepare(`
      SELECT name FROM collections ORDER BY name
    `).all() as Array<{ name: string }>;

        return rows.map(r => r.name);
    }

    async findDocuments(collection: string, query: any): Promise<Document[]> {
        // Need to require SqlTranslator implementation or moving it to core/persistence
        // Assuming it's in the same package for now
        const { SqlTranslator } = require('./sql-translator');
        const { where, params } = SqlTranslator.translate(query);

        const rows = this.db.prepare(`
          SELECT key, data, logical_time, counter, node_id, tombstone
          FROM documents
          WHERE collection = ? AND tombstone = 0 AND ${where}
        `).all(collection, ...params) as Array<{
            key: string;
            data: Buffer;
            logical_time: string;
            counter: number;
            node_id: string;
            tombstone: number;
        }>;

        return rows.map(row => Document.create({
            collection,
            key: row.key,
            data: new Uint8Array(row.data),
            timestamp: HLCTimestamp.create({
                logicalTime: row.logical_time,
                counter: row.counter,
                nodeId: row.node_id
            }),
            tombstone: row.tombstone === 1
        }));
    }

    async getRemotePeers(): Promise<PeerNode[]> {
        const rows = this.db.prepare(`
      SELECT node_id, address, type
      FROM remote_peers
      WHERE is_enabled = 1
    `).all() as Array<{
            node_id: string;
            address: string;
            type: number;
        }>;

        return rows.map(row => ({
            nodeId: row.node_id,
            host: row.address.split(':')[0],
            port: parseInt(row.address.split(':')[1] || '25000'),
            lastSeen: new Date(),
            type: row.type as PeerType
        }));
    }

    async saveRemotePeer(peer: PeerNode): Promise<void> {
        const address = `${peer.host}:${peer.port}`;
        this.db.prepare(`
      INSERT INTO remote_peers (node_id, address, type, is_enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(node_id) DO UPDATE SET
        address = excluded.address,
        type = excluded.type,
        is_enabled = 1
    `).run(peer.nodeId, address, peer.type);
    }

    async removeRemotePeer(nodeId: string): Promise<void> {
        this.db.prepare('DELETE FROM remote_peers WHERE node_id = ?').run(nodeId);
    }

    async close(): Promise<void> {
        this.db.close();
        this.initialized = false;
    }
}
