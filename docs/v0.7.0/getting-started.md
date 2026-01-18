---
layout: default
title: Getting Started with EntglDb.NodeJs
---

# Getting Started with EntglDb.NodeJs v0.7.0

## Installation

EntglDb is modular. Install the core package and necessary adapters:

```bash
pnpm add @entgldb/core @entgldb/persistence-sqlite @entgldb/network
```

## Quick Start

```typescript
import { PeerDb } from '@entgldb/core';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';
import { TcpSyncServer, TcpSyncClient } from '@entgldb/network';

// 1. Initialize Storage
const store = new SqlitePeerStore('./my-db.sqlite');
await store.init();

// 2. Initialize Database
const db = new PeerDb(store);

// 3. Start Server (Optional)
const server = new TcpSyncServer({
    store,
    nodeId: 'node-1',
    port: 3000
});
server.start();

// 4. Sync with Peer
const client = new TcpSyncClient({
    nodeId: 'node-2',
    host: 'localhost',
    port: 3000
});
await client.connect();
await client.pullChanges(db.getLastSyncTime());
```

## New in v0.7.0

### Brotli Compression
EntglDb now supports Brotli compression for network synchronization. This is automatically negotiated and applied if both peers support it.

### Security
Secure Handshake using ECDH is available.
