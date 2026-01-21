import { ISyncOrchestrator } from '../ISyncOrchestrator';

export class NoOpSyncOrchestrator implements ISyncOrchestrator {
    constructor() { }

    async start(): Promise<void> {
        console.log('[NoOpSyncOrchestrator] started (respond-only mode - no outbound sync)');
    }

    async stop(): Promise<void> {
        console.log('[NoOpSyncOrchestrator] stopped');
    }
}
