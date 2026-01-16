import { HLCTimestamp, compareHLCTimestamps } from '@entgldb/protocol';

/**
 * Hybrid Logical Clock implementation
 * 
 * Combines physical time with logical counters to create globally ordered timestamps
 * without requiring clock synchronization across nodes.
 */
export class HLClock {
    private logicalTime: string = '0';
    private counter: number = 0;

    constructor(private readonly nodeId: string) { }

    /**
     * Creates a new timestamp for a local event
     */
    public now(): HLCTimestamp {
        const physicalTime = Date.now().toString();

        if (physicalTime > this.logicalTime) {
            this.logicalTime = physicalTime;
            this.counter = 0;
        } else {
            this.counter++;
        }

        return HLCTimestamp.create({
            logicalTime: this.logicalTime,
            counter: this.counter,
            nodeId: this.nodeId
        });
    }

    /**
     * Updates the clock based on a received timestamp (for sync)
     */
    public update(received: HLCTimestamp): HLCTimestamp {
        const physicalTime = Date.now().toString();
        const maxLogical = this.max(physicalTime, this.logicalTime, received.logicalTime);

        if (maxLogical === physicalTime && physicalTime === this.logicalTime) {
            this.counter++;
        } else if (maxLogical === physicalTime && physicalTime === received.logicalTime) {
            this.counter = received.counter + 1;
        } else if (maxLogical === this.logicalTime && this.logicalTime === received.logicalTime) {
            this.counter = Math.max(this.counter, received.counter) + 1;
        } else if (maxLogical === this.logicalTime) {
            this.counter++;
        } else if (maxLogical === received.logicalTime) {
            this.counter = received.counter + 1;
        } else {
            this.counter = 0;
        }

        this.logicalTime = maxLogical;

        return HLCTimestamp.create({
            logicalTime: this.logicalTime,
            counter: this.counter,
            nodeId: this.nodeId
        });
    }

    private max(...times: string[]): string {
        return times.reduce((max, current) =>
            BigInt(current) > BigInt(max) ? current : max
        );
    }

    /**
     * Compares two timestamps
     * Returns: -1 if a < b, 0 if a == b, 1 if a > b
     */
    public static compare(a: HLCTimestamp, b: HLCTimestamp): number {
        return compareHLCTimestamps(a, b);
    }

    /**
     * Converts timestamp to string representation
     */
    public static toString(ts: HLCTimestamp): string {
        return `${ts.logicalTime}-${ts.counter}-${ts.nodeId}`;
    }

    /**
     * Parses timestamp from string
     */
    public static parse(str: string): HLCTimestamp {
        const parts = str.split('-');
        if (parts.length < 3) {
            throw new Error('Invalid HLC timestamp format');
        }

        return HLCTimestamp.create({
            logicalTime: parts[0],
            counter: parseInt(parts[1], 10),
            nodeId: parts.slice(2).join('-')
        });
    }
}
