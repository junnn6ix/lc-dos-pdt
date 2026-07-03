#!/usr/bin/env bash
set -euo pipefail

# LC-DOS API Test Client
# Usage: bash test-api.sh [pusat|tasikmalaya|surabaya] [operation]

TARGET_NODE="${1:-pusat}"
OPERATION="${2:-health}"

case "$TARGET_NODE" in
  pusat)
    PORT=3001
    BRANCH="tasikmalaya"  # dummy, pusat doesn't use this for most ops
    ;;
  tasikmalaya)
    PORT=3002
    BRANCH="tasikmalaya"
    ;;
  surabaya)
    PORT=3003
    BRANCH="surabaya"
    ;;
  *)
    echo "Unknown node: $TARGET_NODE"
    echo "Usage: bash test-api.sh [pusat|tasikmalaya|surabaya] [operation]"
    exit 1
    ;;
esac

BASE_URL="http://localhost:$PORT"

echo "Testing LC-DOS API on $TARGET_NODE (port $PORT)"
echo ""

case "$OPERATION" in
  health)
    echo "GET $BASE_URL/health"
    curl -s "$BASE_URL/health" | jq .
    ;;

  ping)
    echo "GET $BASE_URL/db/ping"
    curl -s "$BASE_URL/db/ping" | jq .
    ;;

  menus)
    echo "GET $BASE_URL/db/global/menus"
    curl -s "$BASE_URL/db/global/menus" | jq .
    ;;

  tables)
    echo "GET $BASE_URL/db/local/tables"
    curl -s "$BASE_URL/db/local/tables" | jq .
    ;;

  create-order)
    echo "POST $BASE_URL/db/local/orders"
    TABLE_ID="33333333-3333-3333-3333-333333333331"
    if [[ "$BRANCH" == "surabaya" ]]; then
      TABLE_ID="33333333-3333-3333-3333-333333333332"
    fi

    curl -s -X POST "$BASE_URL/db/local/orders" \
      -H "Content-Type: application/json" \
      -d '{
        "tableId": "'$TABLE_ID'",
        "items": [
          {
            "menuId": "22222222-2222-2222-2222-222222222222",
            "quantity": 2,
            "specialNote": "Less ice"
          }
        ],
        "notes": "Test order from automation"
      }' | jq .
    ;;

  price-override)
    echo "POST $BASE_URL/db/local/menu-price-overrides"
    curl -s -X POST "$BASE_URL/db/local/menu-price-overrides" \
      -H "Content-Type: application/json" \
      -d '{
        "menuId": "22222222-2222-2222-2222-222222222222",
        "overridePrice": 25000,
        "reason": "Promo for test"
      }' | jq .
    ;;

  submit-report)
    if [[ "$TARGET_NODE" != "pusat" ]]; then
      echo "Error: Daily report submission only works on pusat node"
      exit 1
    fi

    echo "POST $BASE_URL/api/central/reports"
    curl -s -X POST "$BASE_URL/api/central/reports" \
      -H "Content-Type: application/json" \
      -d '{
        "branchCode": "tasikmalaya",
        "reportDate": "'$(date +%Y-%m-%d)'",
        "totalOrders": 15,
        "totalItemsSold": 42,
        "grossSales": 850000,
        "netSales": 825000,
        "paymentCount": 13,
        "source": "REST_SYNC"
      }' | jq .
    ;;

  *)
    echo "Unknown operation: $OPERATION"
    echo ""
    echo "Available operations:"
    echo "  health           - Check node health"
    echo "  ping             - Test database connectivity"
    echo "  menus            - List global menus"
    echo "  tables           - List local tables"
    echo "  create-order     - Create a test order"
    echo "  price-override   - Upsert menu price override"
    echo "  submit-report    - Submit daily report (pusat only)"
    exit 1
    ;;
esac

echo ""
