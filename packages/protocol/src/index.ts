// Re-export generated types
export * from './generated/sync';

// Protocol version constant
export const PROTOCOL_VERSION = '1.0';

// Type guards and utilities
import { HLCTimestamp, Document, OplogEntry } from './generated/sync';

/**
 * Creates a new HLC timestamp
 */
export function createHLCTimestamp(
    logicalTime: string,
    counter: number,
    nodeId: string
): HLCTimestamp {
    return HLCTimestamp.create({
        logicalTime,
        counter,
        nodeId
    });
}

/**
 * Compares two HLC timestamps
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareHLCTimestamps(a: HLCTimestamp, b: HLCTimestamp): number {
    if (a.logicalTime < b.logicalTime) return -1;
    if (a.logicalTime > b.logicalTime) return 1;

    if (a.counter < b.counter) return -1;
    if (a.counter > b.counter) return 1;

    return a.nodeId.localeCompare(b.nodeId);
}

/**
 * Creates a Document
 */
export function createDocument(
    collection: string,
    key: string,
    data: Uint8Array,
    timestamp: HLCTimestamp,
    tombstone = false
): Document {
    return Document.create({
        collection,
        key,
        data,
        timestamp,
        tombstone
    });
}

/**
 * Creates an Oplog Entry
 */
export function createOplogEntry(
    collection: string,
    key: string,
    data: Uint8Array,
    timestamp: HLCTimestamp,
    operation: 'put' | 'delete'
): OplogEntry {
    return OplogEntry.create({
        collection,
        key,
        data,
        timestamp,
        operation
    });
}
