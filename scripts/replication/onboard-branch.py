import os
import sys
import subprocess
import time

def run_cmd(args, env=None):
    res = subprocess.run(args, capture_output=True, text=True, env=env, shell=True, check=True)
    return res.stdout.strip()

def exec_psql(service, query):
    args = ["docker", "compose", "exec", "-T", service, "psql", "-U", "postgres", "-d", "lettercoffee", "-tA", "-c", query]
    return run_cmd(args)

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/replication/onboard-branch.py <branch_slug>")
        sys.exit(1)
        
    branch = sys.argv[1].lower().strip()
    if branch in ["pusat", "tasikmalaya", "surabaya"]:
        print(f"Error: Branch '{branch}' is already a core branch.")
        sys.exit(1)
        
    print(f"--- ONBOARDING NEW BRANCH: '{branch}' ---")
    
    # 1. Update docker-compose.yml
    dc_path = "docker-compose.yml"
    with open(dc_path, "r") as f:
        dc_content = f.read()
        
    if f"db-{branch}:" not in dc_content:
        print("Updating docker-compose.yml...")
        # Insert db service after db-surabaya
        db_service_template = f"""  db-{branch}:
    image: postgres:16
    container_name: lc-dos-db-{branch}
    environment:
      POSTGRES_DB: lettercoffee
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    command:
      - postgres
      - -c
      - listen_addresses=*
      - -c
      - max_replication_slots=10
      - -c
      - max_wal_senders=10
      - -c
      - max_logical_replication_workers=10
      - -c
      - max_worker_processes=20
      - -c
      - lc.node_role=branch
    ports:
      - "5435:5432"
    volumes:
      - db_{branch}_data:/var/lib/postgresql/data
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro

"""
        # Insert redis service after redis-surabaya
        redis_service_template = f"""  redis-{branch}:
    image: redis:7-alpine
    container_name: lc-dos-redis-{branch}
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6381:6379"
    volumes:
      - redis_{branch}_data:/data

"""
        # Append volume definitions
        volume_template = f"  db_{branch}_data:\n  redis_{branch}_data:\n"
        
        # Perform replacements
        if "  db-surabaya:" in dc_content:
            dc_content = dc_content.replace("  db-surabaya:", db_service_template + "  db-surabaya:")
        if "  redis-surabaya:" in dc_content:
            dc_content = dc_content.replace("  redis-surabaya:", redis_service_template + "  redis-surabaya:")
        if "  redis_surabaya_data:" in dc_content:
            dc_content = dc_content.replace("  redis_surabaya_data:", "  redis_surabaya_data:\n" + volume_template)
            
        with open(dc_path, "w") as f:
            f.write(dc_content)
        print("docker-compose.yml updated successfully.")
    else:
        print("Branch already defined in docker-compose.yml.")

    # 2. Update .env file
    env_path = ".env"
    with open(env_path, "r") as f:
        env_content = f.read()
        
    if f"API_{branch.upper()}_PORT" not in env_content:
        print("Updating .env...")
        env_append = f"""
# API {branch.upper()} (Branch)
API_{branch.upper()}_PORT=3004
API_{branch.upper()}_DATABASE_URL=postgresql://postgres:postgres@localhost:5435/lettercoffee
"""
        with open(env_path, "a") as f:
            f.write(env_append)
        print(".env updated successfully.")
    else:
        print("Branch already configured in .env.")

    # 3. Update root package.json scripts
    pkg_path = "package.json"
    with open(pkg_path, "r") as f:
        pkg_content = f.read()
        
    if f"dev:api-{branch}" not in pkg_content:
        print("Updating package.json scripts...")
        target_script = '"dev:api-surabaya": "tsx apps/api-surabaya/src/main.ts",'
        replacement = target_script + f'\n    "dev:api-{branch}": "tsx apps/api-{branch}/src/main.ts",'
        if target_script in pkg_content:
            pkg_content = pkg_content.replace(target_script, replacement)
            with open(pkg_path, "w") as f:
                f.write(pkg_content)
            print("package.json updated successfully.")
        else:
            print("Warning: dev:api-surabaya script not found in package.json. Please add manually.")
    else:
        print("package.json scripts already configured.")

    # 4. Create apps/api-malang folder and files
    app_dir = f"apps/api-{branch}"
    src_dir = os.path.join(app_dir, "src")
    if not os.path.exists(src_dir):
        print(f"Creating workspace boilerplate for api-{branch}...")
        os.makedirs(src_dir, exist_ok=True)
        
        # package.json
        pkg_data = f"""{{
  "name": "@lcdos/api-{branch}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {{
    "dev": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }},
  "dependencies": {{
    "@lcdos/server-core": "workspace:*",
    "@lcdos/shared": "workspace:*"
  }}
}}
"""
        with open(os.path.join(app_dir, "package.json"), "w") as f:
            f.write(pkg_data)
            
        # tsconfig.json
        ts_data = """{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
"""
        with open(os.path.join(app_dir, "tsconfig.json"), "w") as f:
            f.write(ts_data)
            
        # src/main.ts
        main_data = f"""import {{ startNodeServer }} from "@lcdos/server-core";

await startNodeServer({{
  nodeName: "api-{branch}",
  nodeRole: "branch",
  branchSlug: "{branch}",
  port: Number(process.env.PORT ?? 3004),
  databaseUrl:
    process.env.API_{branch.upper()}_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5435/lettercoffee",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6381",
}});
"""
        with open(os.path.join(src_dir, "main.ts"), "w") as f:
            f.write(main_data)
        print("Workspace files created successfully.")
    else:
        print("Workspace files already exist.")

    print("\n" + "="*50)
    print("STEP REQUIRED: Please start the new database and redis containers.")
    print("Run the following command in another terminal:")
    print(f"  docker compose up -d db-{branch} redis-{branch}")
    print("="*50)
    input("Once you have run that command and the containers are starting, press Enter to continue...")

    # 5. Wait for database container to be ready
    print(f"Waiting for db-{branch} to become ready...")
    ready = False
    for i in range(30):
        try:
            status = run_cmd(["docker", "compose", "exec", "-T", f"db-{branch}", "pg_isready", "-U", "postgres"])
            if "accepting connections" in status:
                ready = True
                break
        except Exception:
            pass
        time.sleep(1)
        
    if not ready:
        print(f"Error: db-{branch} failed to start or accept connections within 30 seconds.")
        sys.exit(1)
    print(f"db-{branch} is ready!")

    # 6. Run pnpm install
    print("Running pnpm install to register new workspace...")
    run_cmd(["pnpm", "install"])
    print("pnpm install completed.")

    # 7. Run Prisma Migration on new database
    print(f"Applying database schema migration to db-{branch}...")
    migration_env = {**os.environ, "DATABASE_URL": f"postgresql://postgres:postgres@localhost:5435/lettercoffee"}
    run_cmd(["pnpm", "prisma", "migrate", "deploy", "--schema", "packages/shared/prisma/schema.prisma"], env=migration_env)
    print("Prisma migrations applied.")

    # 8. Create logical replication subscription
    print(f"Setting up logical replication subscription for db-{branch}...")
    sub_name = f"lc_{branch}_sub"
    sub_exists = exec_psql(f"db-{branch}", f"SELECT count(*) FROM pg_subscription WHERE subname = '{sub_name}';")
    if sub_exists == "0":
        q = f"CREATE SUBSCRIPTION {sub_name} CONNECTION 'host=db-pusat port=5432 dbname=lettercoffee user=lc_replicator password=lc_replicator_dev' PUBLICATION lc_global_pub WITH (copy_data = true);"
        exec_psql(f"db-{branch}", q)
        print(f"Subscription {sub_name} created successfully.")
    else:
        print(f"Subscription {sub_name} already exists.")

    # 9. Register branch on db-pusat (which will replicate to all subscribers)
    print("Registering branch on db-pusat...")
    branch_id = "00000000-0000-0000-0000-000000000003"
    register_q = f"INSERT INTO branches (id, code, name, city, status, timezone, created_at, updated_at) VALUES ('{branch_id}', '{branch}', 'Letter Coffee {branch.capitalize()}', '{branch.capitalize()}', 'ACTIVE', 'Asia/Jakarta', now(), now()) ON CONFLICT (code) DO NOTHING;"
    exec_psql("db-pusat", register_q)
    print("Branch registered on db-pusat.")

    # 10. Seed local tables directly to new database
    print(f"Seeding local dining tables for branch '{branch}'...")
    seed_q = f"INSERT INTO tables (id, branch_id, table_number, qr_code, status, seat_count, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '{branch_id}', 'M-01', 'TOKEN-M01', 'AVAILABLE', 4, now(), now()) ON CONFLICT DO NOTHING;"
    exec_psql(f"db-{branch}", seed_q)
    print("Local tables seeded.")

    print("\n" + "="*50)
    print(f"SUCCESS: Branch '{branch}' successfully onboarded!")
    print(f"You can now run the Malang branch API server using:")
    print(f"  pnpm run dev:api-{branch}")
    print("="*50)

if __name__ == "__main__":
    main()
