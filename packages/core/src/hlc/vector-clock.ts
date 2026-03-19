import { HLCTimestamp } from '@entgldb/protocol';
import { HLClock } from './clock';

export enum CausalityRelation {
    Equal,
    StrictlyAhead,
    StrictlyBehind,
    Concurrent
}

export class VectorClock {
    private clock: Map<string, HLCTimestamp>;

    constructor(initial?: Map<string, HLCTimestamp>) {
        this.clock = initial ? new Map(initial) : new Map();
    }

    get nodeIds(): string[] {
        return Array.from(this.clock.keys());
    }

    getTimestamp(nodeId: string): HLCTimestamp | undefined {
        return this.clock.get(nodeId);
    }

    setTimestamp(nodeId: string, timestamp: HLCTimestamp): void {
        this.clock.set(nodeId, timestamp);
    }

    merge(other: VectorClock): void {
        for (const nodeId of other.nodeIds) {
            const otherTs = other.getTimestamp(nodeId)!;
            const currentTs = this.getTimestamp(nodeId);

            if (!currentTs || HLClock.compare(otherTs, currentTs) > 0) {
                this.setTimestamp(nodeId, otherTs);
            }
        }
    }

    compareTo(other: VectorClock): CausalityRelation {
        let thisAhead = false;
        let otherAhead = false;

        const allNodes = new Set([...this.nodeIds, ...other.nodeIds]);

        for (const nodeId of allNodes) {
            const thisTs = this.getTimestamp(nodeId);
            const otherTs = other.getTimestamp(nodeId);

            // If a node is missing, treat as "zero" timestamp (which is always older than any real timestamp)
            // But strict implementation might require explicit handling. 
            // Assuming missing means "start of time".
            
            let cmp = 0;
            if (thisTs && otherTs) {
                cmp = HLClock.compare(thisTs, otherTs);
            } else if (thisTs && !otherTs) {
                cmp = 1; 
            } else if (!thisTs && otherTs) {
                cmp = -1;
            }

            if (cmp > 0) thisAhead = true;
            if (cmp < 0) otherAhead = true;

            if (thisAhead && otherAhead) return CausalityRelation.Concurrent;
        }

        if (thisAhead && !otherAhead) return CausalityRelation.StrictlyAhead;
        if (otherAhead && !thisAhead) return CausalityRelation.StrictlyBehind;
        return CausalityRelation.Equal;
    }

    getNodesWithUpdates(other: VectorClock): string[] {
        const result: string[] = [];
        const allNodes = new Set(this.clock.keys());
        
        // Add nodes that other has but we don't (implicitly other is ahead)
        for (const nodeId of other.nodeIds) {
            if (!this.clock.has(nodeId)) {
                // Actually if other has a node we don't, other is ahead for that node
                // But usually we track "known nodes". 
                // Wait, logic: "Nodes where OTHER is ahead of THIS"
                // So if I don't have it, and other has it, other is ahead.
                allNodes.add(nodeId);
            }
        }

        for (const nodeId of allNodes) {
            const thisTs = this.getTimestamp(nodeId);
            const otherTs = other.getTimestamp(nodeId);

            // If other has it and (we don't OR other > us)
            if (otherTs) {
                if (!thisTs || HLClock.compare(otherTs, thisTs) > 0) {
                    result.push(nodeId);
                }
            }
        }
        return result;
    }

    getNodesToPush(other: VectorClock): string[] {
        const result: string[] = [];
        const allNodes = new Set([...this.nodeIds, ...other.nodeIds]);

        for (const nodeId of allNodes) {
            const thisTs = this.getTimestamp(nodeId);
            const otherTs = other.getTimestamp(nodeId);

            // If we have it and (other doesn't OR we > other)
            if (thisTs) {
                if (!otherTs || HLClock.compare(thisTs, otherTs) > 0) {
                    result.push(nodeId);
                }
            }
        }
        return result;
    }

    clone(): VectorClock {
        // deepish clone of map (timestamps are immutable-ish usually)
        return new VectorClock(this.clock);
    }

    toString(): string {
        if (this.clock.size === 0) return '{}';
        const entries = Array.from(this.clock.entries())
            .map(([k, v]) => `${k}:${HLClock.toString(v)}`);
        return `{${entries.join(', ')}}`;
    }
}
