import { startNodeServer } from "@lcdos/server-core";

await startNodeServer({
  nodeName: "api-malang",
  nodeRole: "branch",
  branchSlug: "malang",
  port: Number(process.env.PORT ?? 3004),
  databaseUrl:
    process.env.API_MALANG_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5435/lettercoffee",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6381",
});
