# @entgldb/core

Core database engine for EntglDb - platform-agnostic database logic.

## Features

- **HLC Timestamps**: Hybrid Logical Clock for distributed ordering
- **CRDT Semantics**: Last-Write-Wins conflict resolution
- **Storage Abstraction**: IPeerStore interface for different backends
- **Type-safe Collections**: Generic TypeScript collections

## Usage

```typescript
import { PeerDatabase, IPeerStore } from '@entgldb/core';

// Create database with your storage implementation
const db = new PeerDatabase(store, 'my-node-id');
await db.initialize();

// Get a collection
const users = db.collection<User>('users');

// CRUD operations
await users.put('user-1', { name: 'Alice', age: 30 });
const user = await users.get('user-1');
await users.delete('user-1');
```

## Architecture

This package is **storage-agnostic**. You must provide an implementation of `IPeerStore` (e.g., `@entgldb/persistence-sqlite`).

## Testing

```bash
pnpm test
```
