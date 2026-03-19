import { createHash } from 'crypto';
import { OplogEntry, HLCTimestamp } from '@entgldb/protocol';
import { HLClock } from '../hlc/clock';

export function computeOplogHash(entry: OplogEntry): string {
    const sha256 = createHash('sha256');
    const sb: string[] = [];

    // Order: Collection|Key|Operation|Payload|Timestamp|PreviousHash
    // Operation is enum (0=Put, 1=Delete). Node uses exact same proto enum.

    sb.push(entry.collection);
    sb.push('|');
    sb.push(entry.key);
    sb.push('|');
    // Operation is number in protobuf-ts interface usually? Or string?
    // In generated code, enum is usually a number.
    // Check .NET: it appends 'Operation' which is an Enum. 
    // In C# ToString() on Enum returns the name "Put" unless [Flags] or cast.
    // WAIT. .NET code: 'sb.Append(Operation);'
    // Step 14: public OperationType Operation { get; }
    // public enum OperationType { Put, Delete }
    // In C#, sb.Append(enum) appends the string name! "Put", "Delete".
    // Protobuf usually sends integers 0, 1.
    // I need to be careful here. 
    // If .NET computes hash using "Put", I must use "Put".
    // If I use the number 0, hashes will differ.
    // I should check OplogEntry.cs again.
    // Yes, 'sb.Append(Operation)' where Operation is OperationType enum.
    // So it uses names.

    // In Node.js, the generated proto interface likely uses numbers or string literals depending on option.
    // But OplogEntry is the database object, not necessarily the proto message yet?
    // In Node, we often use the Proto interface as the domain object or similar.
    // Let's assume input 'entry' is the ProtoOplogEntry-like structure.
    // If 'operation' is "Put" or "Delete" string, good. 
    // If it's number 0, 1, I need to map it.

    // Let's check sync.proto again.
    // message ProtoOplogEntry { string operation = 3; } -> Wait!
    // In sync.proto (Step 104/106), 'string operation = 3; // "Put" or "Delete"'
    // Ah, in proto it is defined as STRING. 
    // In .NET OplogEntry.cs, it's an Enum, but mapped to string in proto?
    // Step 13 (Net proto): string operation = 3;
    // Step 14 (Net logic): public OperationType Operation { get; } -> SB.Append(Operation).
    // So the hash source is the Enum name "Put"/"Delete".
    // The proto carries a string "Put"/"Delete".
    // So if I use the string from the proto, it should match.

    // BUT, wait.
    // In Node.js, is OplogEntry type using string or enum?
    // Step 71: export type { OplogEntry } from '@entgldb/protocol';
    // If I just updated sync.proto to have `string operation = 3`, then it's string.
    // Previously in Node proto? Step 104: `string operation = 3`.
    // So it's string.

    // OplogEntry domain object has 'data' as Uint8Array, 'timestamp' as object.

    // Operation
    sb.push(entry.operation);
    sb.push('|');

    // Payload
    if (entry.data && entry.data.length > 0) {
        // Decode bytes to string for hashing to match .NET GetRawText()
        // Assuming data is UTF-8 JSON
        sb.push(new TextDecoder().decode(entry.data));
    }
    sb.push('|');

    // Timestamp
    if (entry.timestamp) {
        sb.push(HLClock.toString(entry.timestamp));
    } else {
        // Should not happen for valid entry
        sb.push('0-0-');
    }
    sb.push('|');

    sb.push(entry.previousHash || '');

    sha256.update(sb.join(''));
    return sha256.digest('hex').toLowerCase();
}
