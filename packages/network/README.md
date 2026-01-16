# @entgldb/network

P2P networking and synchronization for EntglDb.

## Features

- **TCP Server/Client**: Binary protocol over TCP
- **Protobuf Messages**: Efficient serialization
- **Sync Orchestrator**: Automatic periodic sync with peers
- **Handshake Protocol**: Auth token + version negotiation
- **Pull-based Sync**: Efficient oplog transfer

## Usage

### Start a Sync Server

```typescript
import { TcpSyncServer } from '@entgldb/network';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';

const store = new SqlitePeerStore('./data/node1.db');
await store.initialize();

const server = new TcpSyncServer(store, 'node-1', 3000, 'secret-token');
server.start();
```

### Connect as Client

```typescript
import { SyncOrchestrator } from '@entgldb/network';

const orchestrator = new SyncOrchestrator({
  store,
  nodeId: 'node-2',
  authToken: 'secret-token',
  syncIntervalMs: 5000
});

orchestrator.addPeer({
  nodeId: 'node-1',
  host: 'localhost',
  port: 3000
});

orchestrator.start();
```

## Protocol

Messages are framed with 4-byte length prefix:
```
[4 bytes length][1 byte type][payload]
```

Message types:
- `1`: Handshake
- `2`: Sync Request/Response
- `3`: Push Request/Response
