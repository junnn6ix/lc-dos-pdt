# LC-DOS Stack Verification Guide

This guide walks you through starting up the complete LC-DOS distributed database system and verifying logical replication.

## Prerequisites

- **Docker Desktop** (running) with `docker compose` support
- **Node.js** 18+ and `npm`
- **pnpm** installed globally (`npm install -g pnpm`)
- `.env` file configured with database URLs (already created at project root)

## Quick Start

### 1. Ensure Docker Desktop is Running

Start Docker Desktop from your Windows Start Menu or system tray. Verify:

```bash
docker ps
```

### 2. Create Database Containers

```bash
npm run db:up
```

This starts three PostgreSQL instances and two Redis instances:

- `db-pusat` (port 5432) - central publisher
- `db-tasikmalaya` (port 5433) - branch subscriber
- `db-surabaya` (port 5434) - branch subscriber
- `redis-tasikmalaya` (port 6379) - local cache
- `redis-surabaya` (port 6380) - local cache

**Wait ~10 seconds for containers to be fully ready.**

### 3. Run Database Migrations

```bash
npm run prisma:migrate
```

This deploys the shared schema to all three PostgreSQL instances simultaneously via `db-pusat`.

### 4. Setup Logical Replication

```bash
npm run db:setup
```

This:

- Creates publication `lc_global_pub` on `db-pusat` for global tables
- Creates subscriptions on `db-tasikmalaya` and `db-surabaya` to pull global data
- Initializes replication with `copy_data = true`

### 5. Verify Replication End-to-End

```bash
npm run db:verify
```

This script:

1. Seeds dummy data (branches, categories, menus, tables, prices) to central database
2. Waits for replication to propagate to both branches (max 60 sec)
3. Checks replication lag:
   - Tasikmalaya target: ≤ 3 seconds lag
   - Surabaya target: ≤ 5 seconds lag
4. Exits with success only if all checks pass

Expected output:

```
Replication setup complete.
Waiting for replication to reach both subscribers...
db-tasikmalaya lag_seconds=0.123 status=streaming limit=3
db-surabaya lag_seconds=0.245 status=streaming limit=5
Replication verification succeeded.
```

---

## Running API Servers

After verification succeeds, start the three API nodes in separate terminal windows:

### Terminal 1: Central

```bash
npm run dev:api-pusat
```

Starts on `http://localhost:3001`

### Terminal 2: Branch Tasikmalaya

```bash
npm run dev:api-tasikmalaya
```

Starts on `http://localhost:3002`

### Terminal 3: Branch Surabaya

```bash
npm run dev:api-surabaya
```

Starts on `http://localhost:3003`

---

## Testing Endpoints

### Health Check (All Nodes)

```bash
curl http://localhost:3001/health | jq .
curl http://localhost:3002/health | jq .
curl http://localhost:3003/health | jq .
```

### Database Connectivity

```bash
curl http://localhost:3001/db/ping | jq .
```

### List Global Menus (Read-only replicated data)

```bash
curl http://localhost:3001/db/global/menus | jq .
curl http://localhost:3002/db/global/menus | jq .
curl http://localhost:3003/db/global/menus | jq .
```

All three should return the same seeded menus.

### List Local Tables (Branch-specific)

```bash
curl http://localhost:3002/db/local/tables | jq .
curl http://localhost:3003/db/local/tables | jq .
```

Tasikmalaya will show `T-01`, Surabaya will show `S-01`.

### Create Order on Branch

```bash
curl -X POST http://localhost:3002/db/local/orders \
  -H "Content-Type: application/json" \
  -d '{
    "tableId": "33333333-3333-3333-3333-333333333331",
    "items": [
      {
        "menuId": "22222222-2222-2222-2222-222222222222",
        "quantity": 2,
        "specialNote": "Less ice"
      }
    ],
    "notes": "Test order"
  }' | jq .
```

Order is created locally on Tasikmalaya's database. The system automatically:

1. Calculates unit price from master + branch override
2. Computes tax (11%)
3. Generates order number

### Upsert Menu Price Override (Branch-local)

```bash
curl -X POST http://localhost:3002/db/local/menu-price-overrides \
  -H "Content-Type: application/json" \
  -d '{
    "menuId": "22222222-2222-2222-2222-222222222222",
    "overridePrice": 25000,
    "reason": "Weekend promo"
  }' | jq .
```

This creates or updates the price override for that branch only. Note: **not** replicated to central.

### Submit Daily Report (Central Only)

```bash
curl -X POST http://localhost:3001/api/central/reports \
  -H "Content-Type: application/json" \
  -d '{
    "branchCode": "tasikmalaya",
    "reportDate": "2026-07-03",
    "totalOrders": 15,
    "totalItemsSold": 42,
    "grossSales": 850000,
    "netSales": 825000,
    "paymentCount": 13,
    "source": "REST_SYNC"
  }' | jq .
```

Only `api-pusat` allows this. Other branches will receive 403 Forbidden.

---

## Automated Test Script

For convenience, use the provided test script:

```bash
# Test pusat health
bash test-api.sh pusat health

# Test tasikmalaya menus
bash test-api.sh tasikmalaya menus

# Create order on surabaya
bash test-api.sh surabaya create-order

# Submit report on pusat
bash test-api.sh pusat submit-report
```

---

## Cleanup

Stop all containers and remove volumes:

```bash
npm run db:down
```

---

## Troubleshooting

### Docker containers don't start

- Ensure Docker Desktop is running (`docker ps` should work)
- Check if ports 5432-5434 and 6379-6380 are already in use
- Run `docker compose down -v && npm run db:up`

### Replication verification fails

- Wait additional 10 seconds after `npm run db:up`
- Check subscription status manually:
  ```bash
  docker compose exec -T db-tasikmalaya psql -U postgres -d lettercoffee \
    -c "SELECT subname, status FROM pg_stat_subscription;"
  ```

### API server won't start

- Ensure database is up: `docker ps`
- Check port availability (3001, 3002, 3003)
- Verify `DATABASE_URL` in `.env` matches your Docker setup

### curl returns connection refused

- Is the API server running? (check terminal for logs)
- Is Docker running? (`docker ps`)
- Check if firewall is blocking localhost ports

---

## Architecture Notes

- **Central (db-pusat, api-pusat)**: Publishes global tables, ingests daily reports, enforces write restrictions
- **Branches (db-tasikmalaya, db-surabaya)**: Subscribe to global tables read-only, maintain local orders/payments, sync daily aggregates
- **Replication**: PostgreSQL logical replication from pusat → branches (one-way)
- **Local Isolation**: `menu_price_overrides` and orders never replicate; each branch owns its local data
- **Middleware**: Role-based access control blocks global table writes on branch nodes
