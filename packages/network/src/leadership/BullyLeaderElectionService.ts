import { ILeaderElectionService, LeadershipChangedHandler, LeadershipChangedEventArgs } from './ILeaderElectionService';
import { IDiscoveryService, IPeerNodeConfigurationProvider, PeerType } from '@entgldb/core';

export class BullyLeaderElectionService implements ILeaderElectionService {
    private _isCloudGateway: boolean = false;
    private _currentGatewayNodeId: string | null = null;
    private _localNodeId: string | null = null;
    private _timer: NodeJS.Timeout | null = null;
    private _handlers: LeadershipChangedHandler[] = [];
    private _running = false;

    constructor(
        private discoveryService: IDiscoveryService,
        private configProvider: IPeerNodeConfigurationProvider,
        private electionIntervalMs: number = 5000
    ) { }

    get isCloudGateway(): boolean {
        return this._isCloudGateway;
    }

    get currentGatewayNodeId(): string | null {
        return this._currentGatewayNodeId;
    }

    async start(): Promise<void> {
        if (this._running) return;

        const config = await this.configProvider.getConfiguration();
        this._localNodeId = config.nodeId;
        this._running = true;

        this._timer = setInterval(() => this.runElection(), this.electionIntervalMs);
        console.log(`[BullyLeaderElectionService] Started for node ${this._localNodeId}`);

        // Run initial election immediately
        this.runElection();
    }

    async stop(): Promise<void> {
        this._running = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        console.log('[BullyLeaderElectionService] Stopped');
    }

    onLeadershipChanged(handler: LeadershipChangedHandler): void {
        this._handlers.push(handler);
    }

    private runElection(): void {
        if (!this._localNodeId) return;

        const peers = this.discoveryService.getActivePeers()
            .filter(p => p.type === PeerType.LanDiscovered)
            .map(p => p.nodeId);

        peers.push(this._localNodeId);

        // Sort lexicographically
        peers.sort();

        // Smallest ID wins
        const newLeader = peers[0];

        if (newLeader !== this._currentGatewayNodeId) {
            const wasLeader = this._isCloudGateway;
            this._currentGatewayNodeId = newLeader;
            this._isCloudGateway = newLeader === this._localNodeId;

            if (wasLeader !== this._isCloudGateway) {
                if (this._isCloudGateway) {
                    console.log('🔐 This node is now the CLOUD GATEWAY (Leader)');
                } else {
                    console.log(`👤 This node is now a MEMBER - Leader: ${this._currentGatewayNodeId}`);
                }

                const args: LeadershipChangedEventArgs = {
                    currentGatewayNodeId: this._currentGatewayNodeId,
                    isCloudGateway: this._isCloudGateway
                };

                this._handlers.forEach(h => h(args));
            }
        }
    }
}
