Write-Host "Generating TypeScript code from Protocol Buffers..." -ForegroundColor Green

# Create output directory
New-Item -ItemType Directory -Force -Path "src/generated" | Out-Null

# Use local protoc from node_modules
& npx @protobuf-ts/protoc `
    --ts_out ./src/generated `
    --ts_opt long_type_string `
    --proto_path ../../proto `
    ../../proto/sync.proto

if ($LASTEXITCODE -eq 0) {
    Write-Host "Protocol generation complete!" -ForegroundColor Green
}
else {
    Write-Host "Protocol generation failed!" -ForegroundColor Red
    exit 1
}
