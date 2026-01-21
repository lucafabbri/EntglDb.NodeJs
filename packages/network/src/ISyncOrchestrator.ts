export interface ISyncOrchestrator {
    start(): Promise<void>;
    stop(): Promise<void>;
}
