import { startNodeServer } from "@lcdos/server-core";

await startNodeServer({
  nodeName: "api-pusat",
  nodeRole: "central",
  branchSlug: "tasikmalaya",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.API_PUSAT_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/lettercoffee",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});
