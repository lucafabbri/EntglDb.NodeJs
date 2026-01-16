#!/bin/bash
set -e

echo "===================================="
echo "EntglDb.NodeJs - P2P Sync Demo"
echo "===================================="
echo ""

cd "$(dirname "$0")/apps/demo"

echo "Checking dependencies..."
pnpm install --silent

echo ""
echo "Starting demo..."
echo ""
echo "[Demo will show:]"
echo "- Node 1 and Node 2 initialization"
echo "- CRUD operations on Node 1"
echo "- P2P sync between nodes"
echo "- Delete operation and tombstone propagation"
echo ""
echo "===================================="
echo ""

pnpm demo

echo ""
echo "===================================="
echo "Demo completed!"
echo "===================================="
