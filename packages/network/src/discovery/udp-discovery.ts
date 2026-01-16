import * as dgram from 'dgram';
import { EventEmitter } from 'events';

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
 * UDP-based peer discovery service
 */
export class UdpDiscovery extends EventEmitter {
    private socket: dgram.Socket | null = null;
    private broadcastTimer: NodeJS.Timeout | null = null;
    private discoveredPeers = new Map<string, DiscoveryInfo>();

    constructor(private readonly options: DiscoveryOptions) {
        super();
    }

    /**
     * Start discovery service
     */
    start(): void {
        const discoveryPort = this.options.discoveryPort || 5353;

        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err) => {
            console.error('[Discovery] Socket error:', err);
        });

        this.socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
        });

        this.socket.on('listening', () => {
            const address = this.socket!.address();
            console.log(`[Discovery] Listening on ${address.address}:${address.port}`);

            // Enable broadcast
            this.socket!.setBroadcast(true);

            // Start broadcasting our presence
            this.startBroadcast();
        });

        this.socket.bind(discoveryPort);
    }

    /**
     * Stop discovery service
     */
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

    /**
     * Get all discovered peers
     */
    getPeers(): DiscoveryInfo[] {
        return Array.from(this.discoveredPeers.values());
    }

    private startBroadcast(): void {
        const interval = this.options.broadcastInterval || 5000;

        const broadcast = () => {
            const message = JSON.stringify({
                nodeId: this.options.nodeId,
                port: this.options.port,
                timestamp: Date.now()
            });

            const discoveryPort = this.options.discoveryPort || 5353;

            // Broadcast to local network
            this.socket!.send(message, discoveryPort, '255.255.255.255', (err) => {
                if (err) {
                    console.error('[Discovery] Broadcast error:', err.message);
                }
            });

            // Also send to localhost for local testing
            this.socket!.send(message, discoveryPort, '127.0.0.1');
        };

        // Broadcast immediately
        broadcast();

        // Then broadcast periodically
        this.broadcastTimer = setInterval(broadcast, interval);
    }

    private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        try {
            const data = JSON.parse(msg.toString());

            // Ignore our own broadcasts
            if (data.nodeId === this.options.nodeId) {
                return;
            }

            const peerInfo: DiscoveryInfo = {
                nodeId: data.nodeId,
                host: rinfo.address === '255.255.255.255' ? '127.0.0.1' : rinfo.address,
                port: data.port
            };

            // Check if this is a new peer
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
