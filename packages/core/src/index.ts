// Main exports
export { PeerDatabase } from './database';
export { PeerCollection } from './collection';

// HLC exports
export { HLClock } from './hlc/clock';

// Storage interface
export { IPeerStore } from './storage/interface';

// Sync and conflict resolution
export * from './sync';

// Re-export protocol types for convenience
// Re-export protocol types for convenience
export type { HLCTimestamp, Document, OplogEntry } from '@entgldb/protocol';

// Query exports
export * from './query/query-node';
export * from './query/translator';


// Network abstractions
export * from './network/PeerNode';
export * from './network/IDiscoveryService';
export * from './network/PeerNodeConfigurationProvider';
