-- Shared bootstrap for all PostgreSQL nodes.
-- The node role is injected through the lc.node_role GUC from docker-compose.

CREATE EXTENSION IF NOT EXISTS pgcrypto;