---
layout: default
---

# EntglDb Node.js Documentation

**EntglDb** is a decentralized, offline-first peer-to-peer database. This repository contains the **Node.js** implementation.

## Installation

```bash
npm install @entgldb/core @entgldb/persistence-sqlite @entgldb/network
```

## Getting Started

### 1. Initialize

```typescript
import { EntglDb } from '@entgldb/core';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';
import { TcpSyncServer, UdpDiscoveryService } from '@entgldb/network';

const store = new SqlitePeerStore('my-db.sqlite');
await store.initialize();

const db = new EntglDb(store);

// Network
const discovery = new UdpDiscoveryService(db.nodeId, 25000);
const server = new TcpSyncServer({
    store,
    nodeId: db.nodeId,
    port: 25000
});

server.start();
discovery.start();
```

### 2. Save Data

```typescript
await db.put('todos', 'todo-1', { title: 'Buy Milk' });
```

### 3. Subscribe to Changes

```typescript
db.on('change', (collections) => {
    console.log('Collections changed:', collections);
});
```

## Dynamic Reconfiguration (v0.8.0)

See [Dynamic Reconfiguration](https://github.com/EntglDb/EntglDb.Net/blob/main/docs/dynamic-reconfiguration.md) in the main documentation.

## Links

*   [**Central Documentation**](https://github.com/EntglDb/EntglDb.Net/tree/main/docs) - Architecture, Protocol, and Concepts.
*   [GitHub Repository](https://github.com/EntglDb/EntglDb.NodeJs)
