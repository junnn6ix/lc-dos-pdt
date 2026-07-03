import subprocess
import sys
import time

def run_cmd(args):
    res = subprocess.run(args, capture_output=True, text=True, check=True)
    return res.stdout.strip()

def exec_psql(service, query):
    args = ["docker", "compose", "exec", "-T", service, "psql", "-U", "postgres", "-d", "lettercoffee", "-tA", "-c", query]
    return run_cmd(args)

def main():
    print("Setting up logical replication...")
    
    # Check if publication exists
    pub_exists = exec_psql("db-pusat", "SELECT count(*) FROM pg_publication WHERE pubname = 'lc_global_pub';")
    if pub_exists == "0":
        # Read setup-publication.sql
        with open("scripts/replication/setup-publication.sql", "r") as f:
            pub_sql = f.read()
        exec_psql("db-pusat", pub_sql)
        print("Publication lc_global_pub created on db-pusat.")
    else:
        print("Publication lc_global_pub already exists on db-pusat.")

    # Create subscriptions
    for service, sub_name in [("db-tasikmalaya", "lc_tasikmalaya_sub"), ("db-surabaya", "lc_surabaya_sub")]:
        exists = exec_psql(service, f"SELECT count(*) FROM pg_subscription WHERE subname = '{sub_name}';")
        if exists == "0":
            q = f"CREATE SUBSCRIPTION {sub_name} CONNECTION 'host=db-pusat port=5432 dbname=lettercoffee user=lc_replicator password=lc_replicator_dev' PUBLICATION lc_global_pub WITH (copy_data = true);"
            exec_psql(service, q)
            print(f"Subscription {sub_name} created on {service}.")
        else:
            print(f"Subscription {sub_name} already exists on {service}.")
            
    print("Replication setup complete.")

if __name__ == "__main__":
    main()
