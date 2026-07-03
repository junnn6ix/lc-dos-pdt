# LC-DOS Foundation

Monorepo ini menyiapkan fondasi database terdistribusi untuk LC-DOS:

- `db-pusat` sebagai publisher logical replication.
- `db-tasikmalaya` dan `db-surabaya` sebagai subscriber sekaligus local primary.
- Redis lokal per cabang untuk cache offline tolerance.
- Prisma schema tunggal untuk migrasi identik di semua node.
- Node.js HTTP servers per cabang dengan Prisma client dan role-based access control.

## Struktur

- `apps/api-pusat`, `apps/api-tasikmalaya`, `apps/api-surabaya`: HTTP servers dengan endpoint baca/tulis lokal.
- `packages/shared`: tipe bersama, klasifikasi tabel, dan skema Prisma.
- `packages/server-core`: runtime server bersama untuk semua node, middleware policy enforcement.
- `infra/postgres`: bootstrap role dan permission database.
- `scripts/replication`: publication, subscription, seed, dan verifikasi replikasi.

## Quick Start

Lihat **[VERIFICATION-GUIDE.md](VERIFICATION-GUIDE.md)** untuk langkah-langkah lengkap:

1. `npm run db:up` - spin up containers
2. `npm run prisma:migrate` - deploy schema
3. `npm run db:setup` - setup logical replication
4. `npm run db:verify` - seed data & check lag
5. `npm run dev:api-*` - start API servers

Lalu test endpoints dengan curl atau script `test-api.sh`.

## Catatan desain

- Tabel global direplikasi dari `db-pusat` ke cabang dan dibatasi write access-nya di role database serta middleware aplikasi.
- `menu_price_overrides` sengaja tidak ikut publication (branch-local only).
- `daily_reports_aggregate` hanya dimaterialkan pada node pusat melalui migrasi yang sama.
- Order dan payment dibuat lokal per branch, tidak direplikasi ke central.
- Daily report aggregate tersimpan di central untuk roll-up analytics.

## API Routes

### Read-only (All nodes)

- `GET /health` - node info
- `GET /db/ping` - database connectivity test
- `GET /db/global/menus` - list global menus (replicated)
- `GET /db/local/tables` - list branch tables
- `GET /meta/classification` - table classification metadata

### Write (Branch-local)

- `POST /db/local/orders` - create order with items
- `POST /db/local/menu-price-overrides` - upsert branch price override

### Write (Central only)

- `POST /api/central/reports` - ingest daily report (branch-specific aggregation)
