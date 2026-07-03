import { startNodeServer } from "@lcdos/server-core";

await startNodeServer({
  nodeName: "api-surabaya",
  nodeRole: "branch",
  branchSlug: "surabaya",
  port: Number(process.env.PORT ?? 3003),
  databaseUrl:
    process.env.API_SURABAYA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5434/lettercoffee",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
});
