import { PeerNode } from './PeerNode';

export interface IDiscoveryService {
    start(): Promise<void>;
    stop(): Promise<void>;
    getActivePeers(): PeerNode[];
}
