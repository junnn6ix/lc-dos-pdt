INSERT INTO branches (id, code, name, city, status, timezone)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'tasikmalaya', 'Letter Coffee Tasikmalaya', 'Tasikmalaya', 'ACTIVE', 'Asia/Jakarta'),
  ('00000000-0000-0000-0000-000000000002', 'surabaya', 'Letter Coffee Surabaya', 'Surabaya', 'ACTIVE', 'Asia/Jakarta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, slug, name, sort_order, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'coffee', 'Coffee', 1, true),
  ('11111111-1111-1111-1111-111111111112', 'non-coffee', 'Non Coffee', 2, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menus (id, category_id, sku, name, description, image_url, availability, is_featured)
VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'LC-ESP-01', 'Espresso', 'Dummy menu item for replication verification', NULL, 'AVAILABLE', false),
  ('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111112', 'LC-LAT-01', 'Latte', 'Second dummy menu item for replication verification', NULL, 'AVAILABLE', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_prices_master (menu_id, base_price)
VALUES
  ('22222222-2222-2222-2222-222222222222', 22000),
  ('22222222-2222-2222-2222-222222222223', 26000)
ON CONFLICT (menu_id) DO NOTHING;

INSERT INTO tables (id, branch_id, table_number, qr_code, status, seat_count)
VALUES
  ('33333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000001', 'T-01', 'QR-TASIK-01', 'AVAILABLE', 4),
  ('33333333-3333-3333-3333-333333333332', '00000000-0000-0000-0000-000000000002', 'S-01', 'QR-SBY-01', 'AVAILABLE', 4)
ON CONFLICT (id) DO NOTHING;