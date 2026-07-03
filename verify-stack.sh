#!/usr/bin/env bash
set -euo pipefail

# LC-DOS Stack Verification Script
# This script assumes Docker Desktop is already running

echo "=========================================="
echo "LC-DOS Stack Verification (Step-by-Step)"
echo "=========================================="

cd "$(dirname "${BASH_SOURCE[0]}")"

# Step 1: Spin up databases
echo ""
echo "Step 1: Starting Docker containers..."
npm run db:up
echo "✓ Containers started. Waiting 5 seconds for services to be ready..."
sleep 5

# Step 2: Run database migrations
echo ""
echo "Step 2: Running Prisma migrations..."
npm run prisma:migrate
echo "✓ Migrations completed."

# Step 3: Setup replication (publication + subscription)
echo ""
echo "Step 3: Setting up logical replication..."
npm run db:setup
echo "✓ Replication setup completed."

# Step 4: Verify replication (seed data + lag check)
echo ""
echo "Step 4: Verifying replication with lag check..."
npm run db:verify
echo "✓ Replication verification succeeded."

# Step 5: Health check endpoints
echo ""
echo "Step 5: Testing API endpoints..."

# Give servers a moment to start
sleep 2

test_endpoint() {
  local port="$1"
  local path="$2"
  local node_name="$3"
  
  echo -n "  Testing $node_name ($port$path)... "
  if curl -s "http://localhost:$port$path" | jq . >/dev/null 2>&1; then
    echo "✓"
  else
    echo "✗ (may not be running yet)"
  fi
}

test_endpoint 3001 "/health" "api-pusat"
test_endpoint 3002 "/health" "api-tasikmalaya"
test_endpoint 3003 "/health" "api-surabaya"

echo ""
echo "=========================================="
echo "Verification Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Start API servers:"
echo "     npm run dev:api-pusat &"
echo "     npm run dev:api-tasikmalaya &"
echo "     npm run dev:api-surabaya &"
echo ""
echo "  2. Test endpoints (examples):"
echo "     curl http://localhost:3001/health"
echo "     curl http://localhost:3001/db/global/menus"
echo "     curl http://localhost:3002/db/local/tables"
echo ""
echo "  3. Create a test order on branch:"
echo "     curl -X POST http://localhost:3002/db/local/orders \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"tableId\": \"33333333-3333-3333-3333-333333333331\", \"items\": [{\"menuId\": \"22222222-2222-2222-2222-222222222222\", \"quantity\": 2}]}'"
echo ""
