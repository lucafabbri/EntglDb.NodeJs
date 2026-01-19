
import { Document, OplogEntry, HLCTimestamp } from './domain';
import { ProtoOplogEntry } from './generated/sync';

export class ProtocolMapper {
    static toProtoOplogEntry(entry: OplogEntry): ProtoOplogEntry {
        return ProtoOplogEntry.create({
            collection: entry.collection,
            key: entry.key,
            operation: entry.operation,
            jsonData: new TextDecoder().decode(entry.data),
            hlcWall: entry.timestamp?.logicalTime || '0',
            hlcLogic: entry.timestamp?.counter || 0,
            hlcNode: entry.timestamp?.nodeId || ''
        });
    }

    static toDomainOplogEntry(proto: ProtoOplogEntry): OplogEntry {
        return OplogEntry.create({
            collection: proto.collection,
            key: proto.key,
            operation: proto.operation,
            data: new TextEncoder().encode(proto.jsonData),
            timestamp: HLCTimestamp.create({
                logicalTime: proto.hlcWall,
                counter: proto.hlcLogic,
                nodeId: proto.hlcNode
            })
        });
    }
}
