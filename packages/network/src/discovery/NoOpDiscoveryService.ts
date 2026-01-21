import { IDiscoveryService, PeerNode } from '@entgldb/core';

export class NoOpDiscoveryService implements IDiscoveryService {
    constructor() { }

    async start(): Promise<void> {
        console.log('[NoOpDiscoveryService] started (passive mode - no UDP discovery)');
    }

    async stop(): Promise<void> {
        console.log('[NoOpDiscoveryService] stopped');
    }

    getActivePeers(): PeerNode[] {
        return [];
    }
}
