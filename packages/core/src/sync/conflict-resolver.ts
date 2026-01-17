import { OplogEntry } from '../storage/interface';

/**
 * Result of conflict resolution between local and remote changes
 */
export class ConflictResolutionResult {
    constructor(
        public readonly shouldApply: boolean,
        public readonly mergedDocument?: any
    ) { }

    static apply(document: any): ConflictResolutionResult {
        return new ConflictResolutionResult(true, document);
    }

    static ignore(): ConflictResolutionResult {
        return new ConflictResolutionResult(false, undefined);
    }
}

/**
 * Interface for conflict resolution strategies
 */
export interface IConflictResolver {
    /**
     * Resolve conflict between local document and remote change
     * @param local - Local document (null if doesn't exist)
     * @param remote - Remote oplog entry
     * @returns Resolution result with merged document if should apply
     */
    resolve(local: any | null, remote: OplogEntry): ConflictResolutionResult;
}
