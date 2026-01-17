import { OplogEntry } from '@entgldb/protocol';
import { IConflictResolver, ConflictResolutionResult } from './conflict-resolver';

/**
 * Last-Write-Wins conflict resolution strategy
 * Resolves conflicts based on HLC timestamp comparison
 */
export class LastWriteWinsConflictResolver implements IConflictResolver {
    resolve(local: any | null, remote: OplogEntry): ConflictResolutionResult {
        // If no local document exists, always apply remote change
        if (local === null || local === undefined) {
            // Construct new document from oplog entry
            const content = remote.data ? JSON.parse(Buffer.from(remote.data).toString('utf-8')) : {};
            const newDoc = {
                collection: remote.collection,
                key: remote.key,
                content,
                updatedAt: remote.timestamp,
                isDeleted: remote.operation === 'delete'
            };
            return ConflictResolutionResult.apply(newDoc);
        }

        // If local exists, compare timestamps
        if (this.compareTimestamps(remote.timestamp, local.updatedAt) > 0) {
            // Remote is newer, apply it
            const content = remote.data ? JSON.parse(Buffer.from(remote.data).toString('utf-8')) : {};
            const newDoc = {
                collection: remote.collection,
                key: remote.key,
                content,
                updatedAt: remote.timestamp,
                isDeleted: remote.operation === 'delete'
            };
            return ConflictResolutionResult.apply(newDoc);
        }

        // Local is newer or equal, ignore remote
        return ConflictResolutionResult.ignore();
    }

    private compareTimestamps(a: any, b: any): number {
        // Compare HLC timestamps
        // Format: { wallTime: bigint, counter: number, nodeId: string }
        if (a.wallTime > b.wallTime) return 1;
        if (a.wallTime < b.wallTime) return -1;

        if (a.counter > b.counter) return 1;
        if (a.counter < b.counter) return -1;

        // If timestamps are equal, compare nodeId for determinism
        return a.nodeId.localeCompare(b.nodeId);
    }
}
