---
layout: default
title: Querying
---

# Querying

EntglDb Node.js provides a MongoDB-like query syntax for local collections, allowing you to filter documents efficiently.

## Basic Querying

You can query documents using the `find` method on a `PeerCollection`.

```typescript
const users = await peerStore.getCollection('users');

// Precise match
const fabio = await users.find({ firstName: 'Fabio' });

// Comparisons using operators
const adults = await users.find({ age: { $gte: 18 } });

// Logical Operators (Implicit AND)
const activeAdmins = await users.find({ 
    isActive: true, 
    role: 'Admin' 
});

// Explicit Logical Operators
const complex = await users.find({ 
    $or: [
        { role: 'Admin' },
        { role: 'Moderator' }
    ]
});
```

## Serialization Consistency

The query engine respects the `namingStrategy` configured for the `json-serialization` adapter.

```typescript
// If translation logic is enabled (e.g. camelToSnake)
// The following query:
await users.find({ firstName: 'Fabio' });

// Will effectively query the underlying JSON field:
// json_extract(data, '$.first_name')
```

## Supported Operators

- `$eq` (Equal) - Default if value is direct
- `$ne` (Not Equal)
- `$gt` (Greater Than)
- `$lt` (Less Than)
- `$gte` (Greater Than or Equal)
- `$lte` (Less Than or Equal)
- `$and` (AND)
- `$or` (OR)
