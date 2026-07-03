CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'branchstatus') THEN
    CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'menuavailability') THEN
    CREATE TYPE "MenuAvailability" AS ENUM ('AVAILABLE', 'HIDDEN', 'SOLD_OUT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tablestatus') THEN
    CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orderstatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paymentmethod') THEN
    CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'CARD', 'TRANSFER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paymentstatus') THEN
    CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reportsource') THEN
    CREATE TYPE "ReportSource" AS ENUM ('REST_SYNC', 'MANUAL_FIX');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "branches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "city" varchar(80) NOT NULL,
  "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Jakarta',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" varchar(80) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "menus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "sku" varchar(64) NOT NULL UNIQUE,
  "name" varchar(160) NOT NULL,
  "description" text,
  "image_url" text,
  "availability" "MenuAvailability" NOT NULL DEFAULT 'AVAILABLE',
  "is_featured" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "menus_category_id_idx" ON "menus"("category_id");

CREATE TABLE IF NOT EXISTS "menu_prices_master" (
  "menu_id" uuid PRIMARY KEY REFERENCES "menus"("id") ON DELETE CASCADE,
  "base_price" numeric(10,2) NOT NULL,
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(64) NOT NULL UNIQUE,
  "title" varchar(120) NOT NULL,
  "description" text,
  "discount_type" varchar(32) NOT NULL,
  "discount_value" numeric(10,2) NOT NULL,
  "starts_at" timestamptz(6) NOT NULL,
  "ends_at" timestamptz(6) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "tables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "table_number" varchar(32) NOT NULL,
  "qr_code" varchar(120) NOT NULL UNIQUE,
  "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
  "seat_count" integer NOT NULL DEFAULT 4,
  "notes" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "tables_branch_id_table_number_key" UNIQUE ("branch_id", "table_number")
);

CREATE INDEX IF NOT EXISTS "tables_branch_id_idx" ON "tables"("branch_id");

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "full_name" varchar(160) NOT NULL,
  "email" varchar(160) UNIQUE,
  "password_hash" text,
  "role" varchar(40) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "users_branch_id_idx" ON "users"("branch_id");

CREATE TABLE IF NOT EXISTS "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "table_id" uuid NOT NULL REFERENCES "tables"("id") ON DELETE RESTRICT,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "order_number" varchar(64) NOT NULL UNIQUE,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "notes" text,
  "subtotal" numeric(12,2) NOT NULL DEFAULT 0,
  "discount" numeric(12,2) NOT NULL DEFAULT 0,
  "tax" numeric(12,2) NOT NULL DEFAULT 0,
  "grand_total" numeric(12,2) NOT NULL,
  "ordered_at" timestamptz(6) NOT NULL DEFAULT now(),
  "completed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "orders_branch_id_idx" ON "orders"("branch_id");
CREATE INDEX IF NOT EXISTS "orders_table_id_idx" ON "orders"("table_id");

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "menu_id" uuid NOT NULL REFERENCES "menus"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "unit_price" numeric(10,2) NOT NULL,
  "line_total" numeric(12,2) NOT NULL,
  "special_note" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "order_items_menu_id_idx" ON "order_items"("menu_id");

CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE CASCADE,
  "method" "PaymentMethod" NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "external_ref" varchar(120),
  "paid_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");

CREATE TABLE IF NOT EXISTS "menu_price_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "menu_id" uuid NOT NULL REFERENCES "menus"("id") ON DELETE CASCADE,
  "override_price" numeric(10,2) NOT NULL,
  "set_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "menu_price_overrides_branch_id_menu_id_key" UNIQUE ("branch_id", "menu_id")
);

CREATE INDEX IF NOT EXISTS "menu_price_overrides_menu_id_idx" ON "menu_price_overrides"("menu_id");

DO $$
BEGIN
  IF current_setting('lc.node_role', true) = 'central' THEN
    CREATE TABLE IF NOT EXISTS "daily_reports_aggregate" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
      "report_date" date NOT NULL,
      "total_orders" integer NOT NULL DEFAULT 0,
      "total_items_sold" integer NOT NULL DEFAULT 0,
      "gross_sales" numeric(14,2) NOT NULL DEFAULT 0,
      "net_sales" numeric(14,2) NOT NULL DEFAULT 0,
      "payment_count" integer NOT NULL DEFAULT 0,
      "source" "ReportSource" NOT NULL DEFAULT 'REST_SYNC',
      "submitted_at" timestamptz(6),
      "created_at" timestamptz(6) NOT NULL DEFAULT now(),
      "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
      CONSTRAINT "daily_reports_aggregate_branch_id_report_date_key" UNIQUE ("branch_id", "report_date")
    );

    CREATE INDEX IF NOT EXISTS "daily_reports_aggregate_report_date_idx" ON "daily_reports_aggregate"("report_date");
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t_name text;
BEGIN
  FOREACH t_name IN ARRAY ARRAY[
    'branches', 'categories', 'menus', 'menu_prices_master', 'promotions',
    'tables', 'users', 'orders', 'order_items', 'payments', 'menu_price_overrides'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;', t_name, t_name);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t_name, t_name);
  END LOOP;

  IF current_setting('lc.node_role', true) = 'central' AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_reports_aggregate'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_daily_reports_aggregate_updated_at ON daily_reports_aggregate;';
    EXECUTE 'CREATE TRIGGER trg_daily_reports_aggregate_updated_at BEFORE UPDATE ON daily_reports_aggregate FOR EACH ROW EXECUTE FUNCTION set_updated_at();';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lc_app') THEN
    CREATE ROLE lc_app LOGIN PASSWORD 'lc_app_dev';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lc_replicator') THEN
    CREATE ROLE lc_replicator LOGIN PASSWORD 'lc_replicator_dev' REPLICATION;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

  IF current_setting('lc.node_role', true) = 'central' THEN
    GRANT USAGE ON SCHEMA public TO lc_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON branches, categories, menus, menu_prices_master, promotions, tables, users, orders, order_items, payments, menu_price_overrides, daily_reports_aggregate TO lc_app;
    GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO lc_app;
    GRANT SELECT ON pg_stat_subscription TO lc_app;
  ELSE
    GRANT USAGE ON SCHEMA public TO lc_app;
    GRANT SELECT ON branches, categories, menus, menu_prices_master, promotions TO lc_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tables, users, orders, order_items, payments, menu_price_overrides TO lc_app;
    GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO lc_app;
    REVOKE INSERT, UPDATE, DELETE ON branches, categories, menus, menu_prices_master, promotions FROM lc_app;
  END IF;

  GRANT CONNECT ON DATABASE lettercoffee TO lc_app;
  GRANT CONNECT ON DATABASE lettercoffee TO lc_replicator;

  -- Grant replication user select permissions on published tables (on central)
  IF current_setting('lc.node_role', true) = 'central' THEN
    GRANT SELECT ON branches, categories, menus, menu_prices_master, promotions TO lc_replicator;
  END IF;
END $$;