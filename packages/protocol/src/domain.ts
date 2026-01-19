
export interface HLCTimestamp {
    logicalTime: string;
    counter: number;
    nodeId: string;
}

export const HLCTimestamp = {
    create(vals: Partial<HLCTimestamp> = {}): HLCTimestamp {
        return {
            logicalTime: vals.logicalTime || '0',
            counter: vals.counter || 0,
            nodeId: vals.nodeId || ''
        };
    }
};

export interface Document {
    collection: string;
    key: string;
    data: Uint8Array;
    timestamp?: HLCTimestamp;
    tombstone: boolean;
}

export const Document = {
    create(vals: Partial<Document> = {}): Document {
        return {
            collection: vals.collection || '',
            key: vals.key || '',
            data: vals.data || new Uint8Array(0),
            timestamp: vals.timestamp,
            tombstone: vals.tombstone || false
        };
    }
};

export interface OplogEntry {
    collection: string;
    key: string;
    data: Uint8Array;
    timestamp?: HLCTimestamp;
    operation: string;
}

export const OplogEntry = {
    create(vals: Partial<OplogEntry> = {}): OplogEntry {
        return {
            collection: vals.collection || '',
            key: vals.key || '',
            data: vals.data || new Uint8Array(0),
            timestamp: vals.timestamp,
            operation: vals.operation || ''
        };
    }
};
