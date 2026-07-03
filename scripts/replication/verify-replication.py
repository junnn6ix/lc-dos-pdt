import subprocess
import sys
import time

def run_cmd(args, input_data=None):
    res = subprocess.run(args, capture_output=True, text=True, input=input_data, check=True)
    return res.stdout.strip()

def exec_psql(service, query):
    args = ["docker", "compose", "exec", "-T", service, "psql", "-U", "postgres", "-d", "lettercoffee", "-c", query]
    return run_cmd(args)

def main():
    print("Seeding global data to db-pusat...")
    with open("scripts/replication/seed-global.sql", "r") as f:
        seed_sql = f.read()
    
    args = ["docker", "compose", "exec", "-T", "db-pusat", "psql", "-U", "postgres", "-d", "lettercoffee"]
    run_cmd(args, input_data=seed_sql)
    print("Seed global data applied to db-pusat.")

    print("Seeding local tables to branch databases directly...")
    # Seed db-tasikmalaya local table
    tasik_table_sql = (
        "INSERT INTO tables (id, branch_id, table_number, qr_code, status, seat_count) "
        "VALUES ('33333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000001', 'T-01', 'QR-TASIK-01', 'AVAILABLE', 4) "
        "ON CONFLICT (id) DO NOTHING;"
    )
    exec_psql("db-tasikmalaya", tasik_table_sql)
    print("Local tables seeded to db-tasikmalaya.")

    # Seed db-surabaya local table
    sby_table_sql = (
        "INSERT INTO tables (id, branch_id, table_number, qr_code, status, seat_count) "
        "VALUES ('33333333-3333-3333-3333-333333333332', '00000000-0000-0000-0000-000000000002', 'S-01', 'QR-SBY-01', 'AVAILABLE', 4) "
        "ON CONFLICT (id) DO NOTHING;"
    )
    exec_psql("db-surabaya", sby_table_sql)
    print("Local tables seeded to db-surabaya.")
    
    print("Waiting for replication to reach both subscribers...")
    menu_id = "22222222-2222-2222-2222-222222222222"
    for service in ["db-tasikmalaya", "db-surabaya"]:
        replicated = False
        for attempt in range(1, 31):
            try:
                count = run_cmd(["docker", "compose", "exec", "-T", service, "psql", "-U", "postgres", "-d", "lettercoffee", "-tA", "-c", f"SELECT count(*) FROM menus WHERE id = '{menu_id}';"])
                if count.strip() == "1":
                    replicated = True
                    break
            except Exception as e:
                pass
            time.sleep(2)
        if not replicated:
            print(f"Error: Replication did not reach {service} in time.")
            sys.exit(1)
            
    print("Triggering dummy update to refresh last_msg_receipt_time on subscribers...")
    exec_psql("db-pusat", "UPDATE branches SET updated_at = now() WHERE code = 'tasikmalaya';")
    time.sleep(1) # Allow 1 second for propagation

    # Check lag
    limits = {"db-tasikmalaya": 3.0, "db-surabaya": 5.0}
    for service, limit in limits.items():
        try:
            snapshot = run_cmd(["docker", "compose", "exec", "-T", service, "psql", "-U", "postgres", "-d", "lettercoffee", "-tA", "-F", "|", "-c", "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - last_msg_receipt_time)), 0), pid FROM pg_stat_subscription LIMIT 1;"])
            parts = snapshot.strip().split("|")
            if len(parts) < 2 or not parts[1]:
                print(f"Error: No active replication worker pid found on {service}: {snapshot}")
                sys.exit(1)
            lag_seconds = float(parts[0])
            pid = parts[1]
        except Exception as e:
            print(f"Error querying subscription status on {service}: {e}")
            sys.exit(1)
            
        if lag_seconds > limit:
            print(f"Error: Lag on {service} is {lag_seconds:.3f} seconds, above limit {limit:.3f}")
            sys.exit(1)
            
        print(f"{service} lag_seconds={lag_seconds:.3f} status=active (pid={pid}) limit={limit}")
        
    print("Replication verification succeeded.")

if __name__ == "__main__":
    main()
