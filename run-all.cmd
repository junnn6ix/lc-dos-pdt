@echo off
echo ==================================================
echo   LC-DOS Distributed Ordering System Bootstrapper
echo ==================================================

echo 1. Starting Docker Database Containers...
docker compose up -d
echo Waiting 8 seconds for database services to be ready...
ping -n 8 127.0.0.1 >nul

echo 2. Generating Prisma Client...
call npx.cmd prisma generate --schema packages/shared/prisma/schema.prisma

echo 3. Running Prisma Migrations on all nodes...
echo Applying migration to db-pusat (Port 5432)...
call npx.cmd prisma migrate deploy --schema packages/shared/prisma/schema.prisma

echo Applying migration to db-tasikmalaya (Port 5433)...
set DATABASE_URL=postgresql://postgres:postgres@localhost:5433/lettercoffee?connection_limit=100
call npx.cmd prisma migrate deploy --schema packages/shared/prisma/schema.prisma

echo Applying migration to db-surabaya (Port 5434)...
set DATABASE_URL=postgresql://postgres:postgres@localhost:5434/lettercoffee?connection_limit=100
call npx.cmd prisma migrate deploy --schema packages/shared/prisma/schema.prisma

echo Applying migration to db-malang (Port 5435)...
set DATABASE_URL=postgresql://postgres:postgres@localhost:5435/lettercoffee?connection_limit=100
call npx.cmd prisma migrate deploy --schema packages/shared/prisma/schema.prisma

rem Reset DATABASE_URL back to default central database
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lettercoffee?connection_limit=100

echo 4. Setting up Logical Replication subscriptions...
python scripts/replication/setup-replication.py

echo Checking/Creating logical replication for Malang branch...
docker compose exec -T db-malang psql -U postgres -d lettercoffee -tA -c "SELECT count(*) FROM pg_subscription WHERE subname = 'lc_malang_sub';" > temp_sub_check.txt
set /p MALANG_SUB_COUNT=<temp_sub_check.txt
del temp_sub_check.txt
if "%MALANG_SUB_COUNT%"=="0" (
  echo Creating subscription for Malang...
  docker compose exec -T db-malang psql -U postgres -d lettercoffee -c "CREATE SUBSCRIPTION lc_malang_sub CONNECTION 'host=db-pusat port=5432 dbname=lettercoffee user=lc_replicator password=lc_replicator_dev' PUBLICATION lc_global_pub WITH (copy_data = true);"
  docker compose exec -T db-pusat psql -U postgres -d lettercoffee -c "INSERT INTO branches (id, code, name, city, status, timezone, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000003', 'malang', 'Letter Coffee Malang', 'Malang', 'ACTIVE', 'Asia/Jakarta', now(), now()) ON CONFLICT (code) DO NOTHING;"
  docker compose exec -T db-malang psql -U postgres -d lettercoffee -c "INSERT INTO tables (id, branch_id, table_number, qr_code, status, seat_count, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000003', 'M-01', 'TOKEN-M01', 'AVAILABLE', 4, now(), now()) ON CONFLICT (id) DO NOTHING;"
) else (
  echo Replication for Malang branch is already set up.
)

echo 5. Verifying Logical Replication status...
python scripts/replication/verify-replication.py

echo 6. Starting API Servers and Next.js Dashboard in separate windows...
start "LC-DOS: API Pusat (Port 3001)" cmd /k "npx.cmd tsx apps/api-pusat/src/main.ts"
start "LC-DOS: API Tasikmalaya (Port 3002)" cmd /k "npx.cmd tsx apps/api-tasikmalaya/src/main.ts"
start "LC-DOS: API Surabaya (Port 3003)" cmd /k "npx.cmd tsx apps/api-surabaya/src/main.ts"
start "LC-DOS: API Malang (Port 3004)" cmd /k "npx.cmd tsx apps/api-malang/src/main.ts"
start "LC-DOS: Web Dashboard (Port 3000)" cmd /k "cd apps\web-dashboard && npx.cmd next dev"

echo ==================================================
echo   System running. Opening dashboard in 5 seconds...
echo ==================================================
ping -n 5 127.0.0.1 >nul
start http://localhost:3000
