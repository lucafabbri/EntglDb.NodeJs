export interface PeerNodeConfiguration {
    nodeId: string;
    tcpPort: number;
    // Add other config fields as needed matching .NET
}

export type ConfigurationChangedHandler = (config: PeerNodeConfiguration) => void;

export interface IPeerNodeConfigurationProvider {
    getConfiguration(): Promise<PeerNodeConfiguration>;
    onConfigurationChanged(handler: ConfigurationChangedHandler): void;
}

export class StaticPeerNodeConfigurationProvider implements IPeerNodeConfigurationProvider {
    private handlers: ConfigurationChangedHandler[] = [];

    constructor(private configuration: PeerNodeConfiguration) { }

    async getConfiguration(): Promise<PeerNodeConfiguration> {
        return this.configuration;
    }

    onConfigurationChanged(handler: ConfigurationChangedHandler): void {
        this.handlers.push(handler);
    }

    updateConfiguration(newConfig: PeerNodeConfiguration): void {
        this.configuration = newConfig;
        this.handlers.forEach(h => h(newConfig));
    }
}
