export enum PeerType {
    LanDiscovered = 0,
    StaticRemote = 1,
    CloudRemote = 2
}

export interface PeerNode {
    nodeId: string;
    host: string; // address in .NET
    port: number;
    lastSeen: Date;
    type: PeerType;
}

export enum NodeRole {
    Member = 0,
    CloudGateway = 1
}
