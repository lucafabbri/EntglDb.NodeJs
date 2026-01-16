// Main exports
export { PeerDatabase } from './database';
export { PeerCollection } from './collection';

// HLC exports
export { HLClock } from './hlc/clock';

// Storage interface
export { IPeerStore } from './storage/interface';

// Re-export protocol types for convenience
export type { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';
