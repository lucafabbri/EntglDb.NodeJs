import { PeerDatabase } from '@entgldb/core';
import { SqlitePeerStore } from '@entgldb/persistence-sqlite';
import { TcpSyncServer, SyncOrchestrator, UdpDiscovery, GossipProtocol } from '@entgldb/network';
import * as fs from 'fs';

interface User {
    name: string;
    age: number;
    email: string;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('=== EntglDb P2P Sync Demo ===\n');

    // Clean up old databases
    if (fs.existsSync('./data/node1.db')) fs.unlinkSync('./data/node1.db');
    if (fs.existsSync('./data/node2.db')) fs.unlinkSync('./data/node2.db');
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');

    // === NODE 1 ===
    console.log('📦 Creating Node 1...');
    const store1 = new SqlitePeerStore('./data/node1.db');
    const db1 = new PeerDatabase(store1, 'node-1');
    await db1.initialize();

    // Start sync server on Node 1
    const server1 = new TcpSyncServer({
        store: store1,
        nodeId: 'node-1',
        port: 3001,
        authToken: 'secret123'
    });
    server1.start();

    // Start UDP Discovery on Node 1
    const discovery1 = new UdpDiscovery({
        nodeId: 'node-1',
        port: 3001,
        discoveryPort: 5353
    });
    discovery1.start();

    // Start Gossip Protocol on Node 1
    const gossip1 = new GossipProtocol({
        store: store1,
        nodeId: 'node-1',
        authToken: 'secret123',
        maxHops: 3
    });

    console.log('✅ Node 1 ready (port 3001)\n');

    // === NODE 2 ===
    console.log('📦 Creating Node 2...');
    const store2 = new SqlitePeerStore('./data/node2.db');
    const db2 = new PeerDatabase(store2, 'node-2');
    await db2.initialize();

    // Start sync server on Node 2
    const server2 = new TcpSyncServer({
        store: store2,
        nodeId: 'node-2',
        port: 3002,
        authToken: 'secret123'
    });
    server2.start();

    // Start UDP Discovery on Node 2
    const discovery2 = new UdpDiscovery({
        nodeId: 'node-2',
        port: 3002,
        discoveryPort: 5353
    });
    discovery2.start();

    // Start Gossip Protocol on Node 2
    const gossip2 = new GossipProtocol({
        store: store2,
        nodeId: 'node-2',
        authToken: 'secret123',
        maxHops: 3
    });

    // Setup sync orchestrator for Node 2 to pull from Node 1
    const orchestrator2 = new SyncOrchestrator({
        store: store2,
        nodeId: 'node-2',
        authToken: 'secret123',
        syncIntervalMs: 2000
    });

    orchestrator2.addPeer({
        nodeId: 'node-1',
        host: 'localhost',
        port: 3001
    });

    // Add peer to gossip
    gossip2.addPeer({
        nodeId: 'node-1',
        host: 'localhost',
        port: 3001
    });

    console.log('✅ Node 2 ready (port 3002)\n');

    // === CRUD OPERATIONS ON NODE 1 ===
    console.log('--- CRUD Operations on Node 1 ---');
    const users1 = db1.collection<User>('users');

    console.log('➕ Adding users to Node 1...');
    await users1.put('alice', { name: 'Alice', age: 30, email: 'alice@test.com' });
    await users1.put('bob', { name: 'Bob', age: 25, email: 'bob@test.com' });
    await users1.put('charlie', { name: 'Charlie', age: 35, email: 'charlie@test.com' });

    console.log('📖 Reading from Node 1:');
    const alice1 = await users1.get('alice');
    console.log('  - Alice:', alice1);

    // === VERIFY DATA ISOLATION (before sync) ===
    console.log('\n--- Before Sync ---');
    const users2 = db2.collection<User>('users');
    const alice2Before = await users2.get('alice');
    console.log('Node 2 - Alice:', alice2Before || 'NOT FOUND (expected)');

    // === START SYNC ===
    console.log('\n--- Starting Sync ---');
    orchestrator2.start();
    console.log('⏳ Syncing...');
    await sleep(3000); // Wait for sync

    // === VERIFY SYNC ===
    console.log('\n--- After Sync ---');
    const alice2After = await users2.get('alice');
    const bob2 = await users2.get('bob');
    const charlie2 = await users2.get('charlie');

    console.log('Node 2 - Alice:', alice2After);
    console.log('Node 2 - Bob:', bob2);
    console.log('Node 2 - Charlie:', charlie2);

    if (alice2After && bob2 && charlie2) {
        console.log('\n✅ SYNC SUCCESS! All data replicated to Node 2');
    } else {
        console.log('\n❌ SYNC FAILED! Some data missing');
    }

    // === UPDATE ON NODE 2 ===
    console.log('\n--- Update on Node 2 ---');
    await users2.put('alice', { name: 'Alice Updated', age: 31, email: 'alice.new@test.com' });
    console.log('✏️  Updated Alice on Node 2');

    await sleep(3000); // Wait for sync back

    // === VERIFY BIDIRECTIONAL SYNC ===
    console.log('\n--- Verify Update Synced to Node 1 ---');
    const alice1Updated = await users1.get('alice');
    console.log('Node 1 - Alice:', alice1Updated);

    if (alice1Updated?.name === 'Alice Updated') {
        console.log('\n✅ BIDIRECTIONAL SYNC WORKING!');
    } else {
        console.log('\n⚠️  Bidirectional sync not yet implemented (expected for pull-only)');
    }

    // === DELETE OPERATION ===
    console.log('\n--- Delete Operation ---');
    await users1.delete('bob');
    console.log('🗑️  Deleted Bob on Node 1');

    await sleep(3000); // Wait for sync

    const bob2AfterDelete = await users2.get('bob');
    console.log('Node 2 - Bob after delete:', bob2AfterDelete || 'DELETED (expected)');

    // === CLEANUP ===
    console.log('\n--- Cleanup ---');
    orchestrator2.stop();
    discovery1.stop();
    discovery2.stop();
    gossip1.stop();
    gossip2.stop();
    server1.stop();
    server2.stop();

    await db1.close();
    await db2.close();

    console.log('\n=== Demo Complete ===');
    process.exit(0);
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
