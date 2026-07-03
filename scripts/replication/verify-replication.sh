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

run_sql() {
  local service="$1"
  local sql="$2"
  "${compose_cmd[@]}" exec -T "$service" psql -U postgres -d lettercoffee -v ON_ERROR_STOP=1 -c "$sql"
}

check_lag() {
  local service="$1"
  local max_lag="$2"
  local snapshot

  snapshot="$(${compose_cmd[@]} exec -T "$service" psql -U postgres -d lettercoffee -tA -F '|' -c "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - last_msg_receipt_time)), 0), status FROM pg_stat_subscription LIMIT 1;")"

  if [[ -z "$snapshot" ]]; then
    echo "No subscription status found on $service"
    exit 1
  fi

  local lag_seconds="${snapshot%%|*}"
  local status="${snapshot#*|}"

  if [[ "$status" != "streaming" && "$status" != "subscribing" ]]; then
    echo "Unexpected subscription status on $service: $status"
    exit 1
  fi

  awk -v lag="$lag_seconds" -v limit="$max_lag" -v service="$service" 'BEGIN { if (lag > limit) { printf("Lag on %s is %.3f seconds, above limit %.3f\n", service, lag, limit); exit 1 } }'
  echo "$service lag_seconds=$lag_seconds status=$status limit=$max_lag"
}

wait_for_postgres db-pusat
wait_for_postgres db-tasikmalaya
wait_for_postgres db-surabaya

"${compose_cmd[@]}" exec -T db-pusat psql -U postgres -d lettercoffee < "$root_dir/scripts/replication/seed-data.sql"

echo "Waiting for replication to reach both subscribers..."

for service in db-tasikmalaya db-surabaya; do
  for attempt in {1..60}; do
    count="$(${compose_cmd[@]} exec -T "$service" psql -U postgres -d lettercoffee -tA -c "SELECT count(*) FROM menus WHERE id = '22222222-2222-2222-2222-222222222222';" | tr -d '[:space:]')"
    if [[ "$count" == "1" ]]; then
      break
    fi
    if [[ "$attempt" == "60" ]]; then
      echo "Replication did not reach $service in time"
      exit 1
    fi
    sleep 2
  done
done

for service in db-tasikmalaya db-surabaya; do
  if [[ "$service" == "db-tasikmalaya" ]]; then
    check_lag "$service" 3
  else
    check_lag "$service" 5
  fi
done

echo "Replication verification succeeded."