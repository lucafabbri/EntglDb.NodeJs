export interface LeadershipChangedEventArgs {
    currentGatewayNodeId: string | null;
    isCloudGateway: boolean;
}

export type LeadershipChangedHandler = (args: LeadershipChangedEventArgs) => void;

export interface ILeaderElectionService {
    isCloudGateway: boolean;
    currentGatewayNodeId: string | null;

    start(): Promise<void>;
    stop(): Promise<void>;

    onLeadershipChanged(handler: LeadershipChangedHandler): void;
}
