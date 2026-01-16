import { PeerDatabase } from '@entgldb/core';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';
import { TcpSyncServer, SyncOrchestrator, UdpDiscovery, GossipProtocol } from '@entgldb/network';
import * as readline from 'readline';
import * as fs from 'fs';

interface User {
    name: string;
    age: number;
    email: string;
}

let db: PeerDatabase | null = null;
let server: TcpSyncServer | null = null;
let orchestrator: SyncOrchestrator | null = null;
let discovery: UdpDiscovery | null = null;
let gossip: GossipProtocol | null = null;
let store: SqlitePeerStore | null = null;

const nodeId = `node-${Math.random().toString(36).substring(7)}`;
const defaultPort = 3000 + Math.floor(Math.random() * 1000);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function showBanner() {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║         EntglDb.NodeJs - Interactive Demo           ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log();
    console.log(`Node ID: ${nodeId}`);
    console.log(`Port: ${defaultPort}`);
    console.log(`Database: node-${defaultPort}.db`);
    console.log();
}

function showMenu() {
    console.log('──────────────────────────────────────────────────────');
    console.log('Commands:');
    console.log('  put <collection> <key> <json>  - Add/Update document');
    console.log('  get <collection> <key>         - Get document');
    console.log('  delete <collection> <key>      - Delete document');
    console.log('  list <collection>              - List all collections');
    console.log('  peer add <host> <port>         - Add peer manually');
    console.log('  peer list                      - List peers');
    console.log('  sync                           - Manual sync now');
    console.log('  status                         - Show node status');
    console.log('  clear                          - Clear screen');
    console.log('  help                           - Show this menu');
    console.log('  exit                           - Exit application');
    console.log('──────────────────────────────────────────────────────');
    console.log('💡 Peers are auto-discovered via UDP broadcast');
    console.log();
}

async function init() {
    showBanner();

    console.log('Initializing database...');

    // Use port-based database name for multiple instances
    const dbPath = `./data/node-${defaultPort}.db`;

    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
    }

    store = new SqlitePeerStore(dbPath);
    db = new PeerDatabase(store, nodeId);
    await db.initialize();

    // Start server
    server = new TcpSyncServer(store, nodeId, defaultPort, 'demo-token');
    server.start();

    // Setup orchestrator
    orchestrator = new SyncOrchestrator({
        store,
        nodeId,
        authToken: 'demo-token',
        syncIntervalMs: 10000 // 10 seconds
    });

    // Start UDP Discovery
    discovery = new UdpDiscovery({
        nodeId,
        port: defaultPort,
        discoveryPort: 5353,
        broadcastInterval: 5000
    });

    discovery.on('peer-discovered', (peerInfo) => {
        // Auto-add discovered peers
        const exists = peers.some(p => p.nodeId === peerInfo.nodeId);
        if (!exists) {
            peers.push(peerInfo);
            orchestrator!.addPeer(peerInfo);

            if (gossip) {
                gossip.addPeer(peerInfo);
            }

            if (!orchestrator) {
                orchestrator!.start();
            }

            console.log(`\n✓ Auto-discovered peer: ${peerInfo.host}:${peerInfo.port}`);
            rl.prompt();
        }
    });

    discovery.start();

    // Start Gossip Protocol
    gossip = new GossipProtocol({
        store,
        nodeId,
        authToken: 'demo-token',
        maxHops: 3,
        gossipDelay: 100
    });

    console.log('✓ Database initialized');
    console.log('✓ Sync server started');
    console.log('✓ UDP Discovery started');
    console.log('✓ Gossip protocol enabled');
    console.log();

    showMenu();
    prompt();
}

function prompt() {
    rl.question('> ', async (input) => {
        await handleCommand(input.trim());
        prompt();
    });
}

async function handleCommand(input: string) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();

    try {
        switch (command) {
            case 'put':
                await handlePut(parts);
                break;
            case 'get':
                await handleGet(parts);
                break;
            case 'delete':
                await handleDelete(parts);
                break;
            case 'list':
                await handleList(parts);
                break;
            case 'peer':
                await handlePeer(parts);
                break;
            case 'sync':
                await handleSync();
                break;
            case 'status':
                showStatus();
                break;
            case 'clear':
                showBanner();
                showMenu();
                break;
            case 'help':
                showMenu();
                break;
            case 'exit':
                await cleanup();
                process.exit(0);
            case '':
                break;
            default:
                console.log(`Unknown command: ${command}`);
                console.log('Type "help" for available commands');
        }
    } catch (error: any) {
        console.error(`Error: ${error.message}`);
    }
}

async function handlePut(parts: string[]) {
    if (parts.length < 4) {
        console.log('Usage: put <collection> <key> <json>');
        console.log('Example: put users alice {"name":"Alice","age":30,"email":"alice@test.com"}');
        return;
    }

    const collection = parts[1];
    const key = parts[2];
    const jsonStr = parts.slice(3).join(' ');

    try {
        const data = JSON.parse(jsonStr);
        const col = db!.collection(collection);
        await col.put(key, data);
        console.log(`✓ Document added: ${collection}/${key}`);
    } catch (error: any) {
        console.error(`Failed to parse JSON: ${error.message}`);
    }
}

async function handleGet(parts: string[]) {
    if (parts.length < 3) {
        console.log('Usage: get <collection> <key>');
        return;
    }

    const collection = parts[1];
    const key = parts[2];

    const col = db!.collection(collection);
    const data = await col.get(key);

    if (data) {
        console.log(`${collection}/${key}:`, JSON.stringify(data, null, 2));
    } else {
        console.log(`Document not found: ${collection}/${key}`);
    }
}

async function handleDelete(parts: string[]) {
    if (parts.length < 3) {
        console.log('Usage: delete <collection> <key>');
        return;
    }

    const collection = parts[1];
    const key = parts[2];

    const col = db!.collection(collection);
    await col.delete(key);
    console.log(`✓ Document deleted: ${collection}/${key}`);
}

async function handleList(parts: string[]) {
    const collections = await db!.getCollections();

    if (collections.length === 0) {
        console.log('No collections found');
    } else {
        console.log('Collections:');
        collections.forEach(col => console.log(`  - ${col}`));
    }
}

const peers: Array<{ nodeId: string; host: string; port: number }> = [];

async function handlePeer(parts: string[]) {
    if (parts.length < 2) {
        console.log('Usage:');
        console.log('  peer add <host> <port>');
        console.log('  peer list');
        return;
    }

    const subcommand = parts[1].toLowerCase();

    if (subcommand === 'add') {
        if (parts.length < 4) {
            console.log('Usage: peer add <host> <port>');
            return;
        }

        const host = parts[2];
        const port = parseInt(parts[3], 10);
        const peerNodeId = `peer-${host}:${port}`;

        const peer = { nodeId: peerNodeId, host, port };
        peers.push(peer);
        orchestrator!.addPeer(peer);

        if (!orchestrator) {
            orchestrator!.start();
        }

        console.log(`✓ Peer added: ${host}:${port}`);
    } else if (subcommand === 'list') {
        if (peers.length === 0) {
            console.log('No peers configured');
        } else {
            console.log('Peers:');
            peers.forEach(p => console.log(`  - ${p.host}:${p.port}`));
        }
    } else {
        console.log(`Unknown peer command: ${subcommand}`);
    }
}

async function handleSync() {
    if (peers.length === 0) {
        console.log('No peers configured. Use "peer add <host> <port>" first');
        return;
    }

    console.log('Syncing with all peers...');
    await orchestrator!.syncWithAllPeers();
    console.log('✓ Sync completed');
}

function showStatus() {
    console.log('──────────────────────────────────────────────────────');
    console.log('Node Status:');
    console.log(`  Node ID: ${nodeId}`);
    console.log(`  Port: ${defaultPort}`);
    console.log(`  Database: node-${defaultPort}.db`);
    console.log(`  Peers: ${peers.length}`);
    console.log(`  Sync: ${orchestrator ? 'Active' : 'Inactive'}`);
    console.log(`  Discovery: ${discovery ? 'Active' : 'Inactive'}`);
    console.log(`  Gossip: ${gossip ? 'Enabled' : 'Disabled'}`);
    console.log('──────────────────────────────────────────────────────');
}

async function cleanup() {
    console.log('\nShutting down...');

    if (gossip) {
        gossip.stop();
    }

    if (discovery) {
        discovery.stop();
    }

    if (orchestrator) {
        orchestrator.stop();
    }

    if (server) {
        server.stop();
    }

    if (db) {
        await db.close();
    }

    rl.close();
    console.log('Goodbye!');
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
});

// Start the application
init().catch(error => {
    console.error('Failed to initialize:', error);
    process.exit(1);
});
