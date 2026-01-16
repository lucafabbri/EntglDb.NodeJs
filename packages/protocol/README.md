# @entgldb/protocol

Protocol Buffers definitions and TypeScript bindings for EntglDb.

## Usage

```typescript
import { 
  HLCTimestamp, 
  Document, 
  HandshakeRequest,
  createHLCTimestamp,
  compareHLCTimestamps 
} from '@entgldb/protocol';

// Create HLC timestamp
const timestamp = createHLCTimestamp(1000n, 0, 'node-1');

// Compare timestamps
const comparison = compareHLCTimestamps(ts1, ts2);
```

## Development

### Generate Types
```bash
pnpm generate
```

### Build
```bash
pnpm build
```

## Protocol Version

Current: **1.0**
