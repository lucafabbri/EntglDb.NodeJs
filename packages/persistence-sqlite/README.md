# @entgldb/persistence-sqlite

SQLite persistence adapter for EntglDb using `better-sqlite3`.

## Features

- **WAL Mode**: Write-Ahead Logging for better concurrency
- **Indexed Timestamps**: Fast oplog queries
- **Transaction Support**: ACID guarantees
- **Schema Versioning**: Ready for migrations

## Usage

```typescript
import { PeerDatabase } from '@entgldb/core';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';

// Create store
const store = new SqlitePeerStore('./data/my-db.sqlite');

// Create database
const db = new PeerDatabase(store, 'node-1');
await db.initialize();

// Use collections
const users = db.collection('users');
await users.put('alice', { name: 'Alice' });
```

## Database Schema

- **collections**: Collection registry
- **documents**: Current document state (with HLC timestamps)
- **oplog**: Operation log for synchronization

## Performance

- Uses `better-sqlite3` (synchronous, fast)
- WAL mode enabled by default
- Indexed by HLC timestamp for efficient sync queries
