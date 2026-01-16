#!/bin/bash
set -e

echo "Generating TypeScript code from Protocol Buffers..."

# Create output directory
mkdir -p src/generated

# Generate TypeScript code using protobuf-ts
npx protoc \
  --plugin=./node_modules/.bin/protoc-gen-ts \
  --ts_out=./src/generated \
  --ts_opt=long_type_string \
  --ts_opt=generate_dependencies \
  --proto_path=../../proto \
  ../../proto/sync.proto

echo "✓ Protocol generation complete!"
