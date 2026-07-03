import { startNodeServer } from "@lcdos/server-core";

await startNodeServer({
  nodeName: "api-tasikmalaya",
  nodeRole: "branch",
  branchSlug: "tasikmalaya",
  port: Number(process.env.PORT ?? 3002),
  databaseUrl:
    process.env.API_TASIKMALAYA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5433/lettercoffee",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});
