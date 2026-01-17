import { OplogEntry } from '@entgldb/protocol';
import { IConflictResolver, ConflictResolutionResult } from './conflict-resolver';

/**
 * Recursive JSON merge conflict resolution strategy
 * Performs deep merge of JSON objects with intelligent array handling
 */
export class RecursiveNodeMergeConflictResolver implements IConflictResolver {
    resolve(local: any | null, remote: OplogEntry): ConflictResolutionResult {
        // If no local document, apply remote
        if (local === null || local === undefined) {
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

        // If remote is delete, check timestamp
        if (remote.operation === 'delete') {
            if (this.compareTimestamps(remote.timestamp, local.updatedAt) > 0) {
                const newDoc = {
                    collection: remote.collection,
                    key: remote.key,
                    content: {},
                    updatedAt: remote.timestamp,
                    isDeleted: true
                };
                return ConflictResolutionResult.apply(newDoc);
            }
            return ConflictResolutionResult.ignore();
        }

        const localContent = local.content;
        const remoteContent = remote.data ? JSON.parse(Buffer.from(remote.data).toString('utf-8')) : {};
        const localTs = local.updatedAt;
        const remoteTs = remote.timestamp;

        // If either is undefined/null, use LWW
        if (!localContent || !remoteContent) {
            if (this.compareTimestamps(remoteTs, localTs) > 0) {
                return ConflictResolutionResult.apply({
                    collection: remote.collection,
                    key: remote.key,
                    content: remoteContent,
                    updatedAt: remoteTs,
                    isDeleted: false
                });
            }
            return ConflictResolutionResult.ignore();
        }

        // Perform recursive merge
        const mergedContent = this.mergeJson(localContent, localTs, remoteContent, remoteTs);
        const maxTimestamp = this.compareTimestamps(remoteTs, localTs) > 0 ? remoteTs : localTs;

        const mergedDoc = {
            collection: remote.collection,
            key: remote.key,
            content: mergedContent,
            updatedAt: maxTimestamp,
            isDeleted: false
        };

        return ConflictResolutionResult.apply(mergedDoc);
    }

    private mergeJson(local: any, localTs: any, remote: any, remoteTs: any): any {
        // If types differ, use LWW
        const localType = this.getType(local);
        const remoteType = this.getType(remote);

        if (localType !== remoteType) {
            return this.compareTimestamps(remoteTs, localTs) > 0 ? remote : local;
        }

        // Handle objects
        if (localType === 'object') {
            return this.mergeObjects(local, localTs, remote, remoteTs);
        }

        // Handle arrays
        if (localType === 'array') {
            return this.mergeArrays(local, localTs, remote, remoteTs);
        }

        // Primitives - use LWW
        if (local === remote) {
            return local;
        }
        return this.compareTimestamps(remoteTs, localTs) > 0 ? remote : local;
    }

    private mergeObjects(local: any, localTs: any, remote: any, remoteTs: any): any {
        const result: any = {};
        const processedKeys = new Set<string>();

        // Process local keys
        for (const key of Object.keys(local)) {
            processedKeys.add(key);

            if (key in remote) {
                // Collision - merge recursively
                result[key] = this.mergeJson(local[key], localTs, remote[key], remoteTs);
            } else {
                // Only in local
                result[key] = local[key];
            }
        }

        // Add remaining remote keys
        for (const key of Object.keys(remote)) {
            if (!processedKeys.has(key)) {
                result[key] = remote[key];
            }
        }

        return result;
    }

    private mergeArrays(local: any[], localTs: any, remote: any[], remoteTs: any): any[] {
        // Heuristic: check if arrays contain objects
        const localHasObjects = this.hasObjects(local);
        const remoteHasObjects = this.hasObjects(remote);

        // If both don't have objects or mismatch, use LWW
        if (!localHasObjects || !remoteHasObjects || localHasObjects !== remoteHasObjects) {
            return this.compareTimestamps(remoteTs, localTs) > 0 ? remote : local;
        }

        // Both have objects - try to merge by ID
        const localMap = this.mapById(local);
        const remoteMap = this.mapById(remote);

        // If couldn't create ID maps, fallback to LWW
        if (!localMap || !remoteMap) {
            return this.compareTimestamps(remoteTs, localTs) > 0 ? remote : local;
        }

        const result: any[] = [];
        const processedIds = new Set<string>();

        // Process local items
        for (const [id, localItem] of localMap.entries()) {
            processedIds.add(id);

            if (remoteMap.has(id)) {
                // Merge recursively
                const remoteItem = remoteMap.get(id)!;
                result.push(this.mergeJson(localItem, localTs, remoteItem, remoteTs));
            } else {
                // Keep local item
                result.push(localItem);
            }
        }

        // Add new remote items
        for (const [id, remoteItem] of remoteMap.entries()) {
            if (!processedIds.has(id)) {
                result.push(remoteItem);
            }
        }

        return result;
    }

    private hasObjects(arr: any[]): boolean {
        if (arr.length === 0) return false;
        return this.getType(arr[0]) === 'object';
    }

    private mapById(arr: any[]): Map<string, any> | null {
        const map = new Map<string, any>();

        for (const item of arr) {
            if (this.getType(item) !== 'object') return null;

            let id: string | null = null;
            if ('id' in item) id = String(item.id);
            else if ('_id' in item) id = String(item._id);

            if (!id) return null; // Missing ID
            if (map.has(id)) return null; // Duplicate ID

            map.set(id, item);
        }

        return map;
    }

    private getType(value: any): string {
        if (value === null || value === undefined) return 'null';
        if (Array.isArray(value)) return 'array';
        return typeof value;
    }

    private compareTimestamps(a: any, b: any): number {
        if (a.wallTime > b.wallTime) return 1;
        if (a.wallTime < b.wallTime) return -1;

        if (a.counter > b.counter) return 1;
        if (a.counter < b.counter) return -1;

        return a.nodeId.localeCompare(b.nodeId);
    }
}
