import dgram from 'react-native-udp';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

export interface DiscoveryInfo {
    nodeId: string;
    host: string;
    port: number;
}

export interface DiscoveryOptions {
    nodeId: string;
    port: number;
    discoveryPort?: number;
    broadcastInterval?: number;
}

/**
 * UDP Discovery for React Native
 */
export class UdpDiscovery extends EventEmitter {
    private socket: any = null;
    private broadcastTimer: NodeJS.Timeout | null = null;
    private discoveredPeers = new Map<string, DiscoveryInfo>();

    constructor(private readonly options: DiscoveryOptions) {
        super();
    }

    start(): void {
        const discoveryPort = this.options.discoveryPort || 5353;

        this.socket = dgram.createSocket({
            type: 'udp4',
            reusePort: true,
        });

        this.socket.on('error', (err: Error) => {
            console.error('[Discovery] Socket error:', err);
        });

        this.socket.on('message', (msg: Buffer, rinfo: any) => {
            this.handleMessage(msg, rinfo);
        });

        this.socket.on('listening', () => {
            console.log(`[Discovery] Listening on port ${discoveryPort}`);
            // React Native UDP specific: broadcast must be enabled
            this.socket.setBroadcast(true);
            this.startBroadcast();
        });

        this.socket.bind(discoveryPort);
    }

    stop(): void {
        if (this.broadcastTimer) {
            clearInterval(this.broadcastTimer);
            this.broadcastTimer = null;
        }

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.discoveredPeers.clear();
    }

    getPeers(): DiscoveryInfo[] {
        return Array.from(this.discoveredPeers.values());
    }

    private startBroadcast(): void {
        const interval = this.options.broadcastInterval || 5000;

        const broadcast = () => {
            const message = JSON.stringify({
                nodeId: this.options.nodeId,
                port: this.options.port,
                timestamp: Date.now(),
            });

            const discoveryPort = this.options.discoveryPort || 5353;
            // Use local Buffer shim if needed, or global
            const buffer = Buffer.from(message);

            // Broadcast to network
            if (this.socket) {
                this.socket.send(
                    buffer,
                    0,
                    buffer.length,
                    discoveryPort,
                    '255.255.255.255',
                    (err: Error) => {
                        if (err) {
                            console.error('[Discovery] Broadcast error:', err.message);
                        }
                    }
                );
            }
        };

        broadcast();
        this.broadcastTimer = setInterval(broadcast, interval);
    }

    private handleMessage(msg: Buffer, rinfo: any): void {
        try {
            const data = JSON.parse(msg.toString());

            if (data.nodeId === this.options.nodeId) {
                return;
            }

            const peerInfo: DiscoveryInfo = {
                nodeId: data.nodeId,
                host: rinfo.address,
                port: data.port,
            };

            if (!this.discoveredPeers.has(peerInfo.nodeId)) {
                this.discoveredPeers.set(peerInfo.nodeId, peerInfo);
                console.log(`[Discovery] Found peer: ${peerInfo.nodeId} at ${peerInfo.host}:${peerInfo.port}`);
                this.emit('peer-discovered', peerInfo);
            }
        } catch (error) {
            // Ignore malformed messages
        }
    }
}
