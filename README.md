# EntglDb.NodeJs

Pure JavaScript/TypeScript implementation of EntglDb - A peer-to-peer distributed database with offline-first capabilities.

## 🚀 Quick Start

### Run the Interactive Demo

```bash
# Windows
run-demo.bat

# macOS/Linux
./run-demo.sh
```

### Run Electron Desktop App

```bash
# Windows
run-electron.bat

# macOS/Linux
./run-electron.sh
```

### Run React Native Mobile App

```bash
# Windows
run-react-native.bat

# macOS/Linux
./run-react-native.sh
```

Or manually:
```bash
cd apps/demo
pnpm install
pnpm demo
```

## 📦 Packages

- **@entgldb/protocol** - Protocol Buffers definitions
- **@entgldb/core** - Core database engine (HLC, CRDT, Collections)
- **@entgldb/persistence-sqlite** - SQLite storage adapter
- **@entgldb/network** - P2P networking (TCP, WebSocket)

## 🎯 Sample Applications

### Electron Desktop App
```bash
cd apps/sample-electron
pnpm install
pnpm dev
```

### React Native Mobile App
```bash
cd apps/sample-react-native
pnpm install
cd ios && pod install && cd ..
pnpm ios    # or pnpm android
```

## 🏗️ Development

### Install Dependencies
```bash
pnpm install
```

### Build All Packages
```bash
pnpm build
```

### Run Tests
```bash
pnpm test
```

## 📚 Documentation

See [walkthrough.md](file:///C:/Users/FABLUA/.gemini/antigravity/brain/95865bf1-3161-4920-ac82-d76d69e924cd/walkthrough.md) for comprehensive documentation.

## ✨ Features

- ✅ **Hybrid Logical Clocks (HLC)** for distributed ordering
- ✅ **Last-Write-Wins (LWW)** conflict resolution
- ✅ **SQLite** persistence with WAL mode
- ✅ **P2P Sync** via TCP with Protocol Buffers (v4)
- ✅ **Brotli Compression** for efficient bandwidth usage
- ✅ **Multi-platform**: Node.js, Electron, React Native
- ✅ **Type-safe** TypeScript API

## 🔧 Architecture

```
EntglDb.NodeJs/
├── packages/
│   ├── protocol/          # Protobuf definitions
│   ├── core/             # Database engine
│   ├── persistence-sqlite/ # SQLite adapter
│   └── network/          # P2P networking
└── apps/
    ├── demo/             # CLI demo
    ├── sample-electron/  # Desktop app
    └── sample-react-native/ # Mobile app
```

## 🔗 Protocol Compatibility

Compatible with EntglDb.NET v0.7.0, EntglDb.Kotlin v0.7.0
Features: Brotli compression, Secure Handshake.

## 📄 License

MIT
