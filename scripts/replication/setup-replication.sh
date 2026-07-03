#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_cmd=(docker compose)

wait_for_postgres() {
  local service="$1"
  local attempts=60
  until "${compose_cmd[@]}" exec -T "$service" pg_isready -U postgres -d lettercoffee >/dev/null 2>&1; do
    attempts=$((attempts - 1))
    if [[ "$attempts" -le 0 ]]; then
      echo "Timed out waiting for $service"
      exit 1
    fi
    sleep 2
  done
}

wait_for_postgres db-pusat
wait_for_postgres db-tasikmalaya
wait_for_postgres db-surabaya

"${compose_cmd[@]}" exec -T db-pusat psql -U postgres -d lettercoffee < "$root_dir/scripts/replication/setup-publication.sql"

create_subscription() {
  local service="$1"
  local subscription_name="$2"
  local exists

  exists="$(${compose_cmd[@]} exec -T "$service" psql -U postgres -d lettercoffee -tA -c "SELECT count(*) FROM pg_subscription WHERE subname = '$subscription_name';" | tr -d '[:space:]')"

  if [[ "$exists" == "0" ]]; then
    "${compose_cmd[@]}" exec -T "$service" psql -U postgres -d lettercoffee \
      -c "CREATE SUBSCRIPTION $subscription_name CONNECTION 'host=db-pusat port=5432 dbname=lettercoffee user=lc_replicator password=lc_replicator_dev' PUBLICATION lc_global_pub WITH (copy_data = true);"
  fi
}

create_subscription db-tasikmalaya lc_tasikmalaya_sub
create_subscription db-surabaya lc_surabaya_sub

echo "Replication setup complete."