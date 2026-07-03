import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { Server as SocketIOServer } from "socket.io";

import {
  GLOBAL_TABLES,
  LOCAL_TABLES,
  REPLICATION_LAG_ALERT_SECONDS,
  type BranchSlug,
  type NodeRole,
  resolveEffectiveMenuPrice,
} from "@lcdos/shared";
import { createPrismaClient } from "./db.js";

export type NodeRuntimeConfig = {
  nodeName: string;
  nodeRole: NodeRole;
  branchSlug: BranchSlug;
  port: number;
  databaseUrl: string;
  redisUrl?: string;
};

type JsonResponse = Record<string, unknown>;

type RequestBody = Record<string, unknown>;

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: JsonResponse,
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function parseNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateOnly(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function readJsonBody(
  request: http.IncomingMessage,
): Promise<RequestBody> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    return {};
  }

  return JSON.parse(raw) as RequestBody;
}

async function readRawBody(
  request: http.IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }

  return Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function ensureCentralWriteAccess(nodeRole: NodeRole) {
  if (nodeRole !== "central") {
    const error = new Error("Global table writes are restricted to db-pusat.");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

function routeWritePolicy(
  nodeRole: NodeRole,
  pathname: string,
  method: string,
) {
  if (method === "POST" && pathname.startsWith("/admin/global")) {
    ensureCentralWriteAccess(nodeRole);
  }

  if (method === "POST" && pathname.startsWith("/db/global")) {
    ensureCentralWriteAccess(nodeRole);
  }
}

export async function startNodeServer(
  config: NodeRuntimeConfig,
): Promise<http.Server> {
  const prisma = createPrismaClient({ databaseUrl: config.databaseUrl });

  let queue: Queue | undefined;
  let worker: Worker | undefined;
  let monitoringIntervalId: NodeJS.Timeout | undefined;
  let redisClient: Redis | undefined;
  let io: SocketIOServer | undefined;
  let broadcastBranchEvent: (branchSlug: string, eventName: string, payload: unknown) => void = () => {};

  if (config.redisUrl) {
    redisClient = new Redis(config.redisUrl);
  }

  if (config.nodeRole === "branch") {
    const redisUrl = config.redisUrl || "redis://localhost:6379";
    const parsedUrl = new URL(redisUrl);
    const connectionOpts = {
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 6379),
      username: parsedUrl.username || undefined,
      password: parsedUrl.password || undefined,
      maxRetriesPerRequest: null,
    };

    queue = new Queue("daily-report-queue", { connection: connectionOpts });

    worker = new Worker(
      "daily-report-queue",
      async (job) => {
        let { reportDate } = job.data as { reportDate?: string };
        if (!reportDate) {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, "0");
          const day = String(today.getDate()).padStart(2, "0");
          reportDate = `${year}-${month}-${day}`;
        }
        console.log(`[${config.nodeName}] Starting daily report sync for date: ${reportDate}`);

        // 1. Resolve branch ID
        const branch = await prisma.branch.findUnique({
          where: { code: config.branchSlug },
        });
        if (!branch) {
          throw new Error(`Branch slug ${config.branchSlug} not found in database.`);
        }

        // 2. Query transactions for the day
        const startOfDay = new Date(`${reportDate}T00:00:00.000Z`);
        const endOfDay = new Date(`${reportDate}T23:59:59.999Z`);

        const orders = await prisma.order.findMany({
          where: {
            branchId: branch.id,
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
            status: {
              not: "CANCELLED",
            },
          },
          include: {
            items: true,
            payment: true,
          },
        });

        // 3. Compute aggregates
        const totalOrders = orders.length;
        let totalItemsSold = 0;
        let grossSales = 0;
        let netSales = 0;
        let paymentCount = 0;

        for (const order of orders) {
          totalItemsSold += order.items.reduce((sum, item) => sum + item.quantity, 0);
          grossSales += Number(order.grandTotal);
          netSales += Number(order.subtotal);
          if (order.payment && order.payment.status === "PAID") {
            paymentCount++;
          }
        }

        // 4. Send REST API to Pusat
        const centralUrl = "http://localhost:3001/api/central/reports";
        const payload = {
          branchCode: config.branchSlug,
          reportDate,
          totalOrders,
          totalItemsSold,
          grossSales,
          netSales,
          paymentCount,
          source: "REST_SYNC",
        };

        console.log(`[${config.nodeName}] Sending report payload to central: ${JSON.stringify(payload)}`);

        const response = await fetch(centralUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Failed to send report. Status: ${response.status}. Response: ${bodyText}`);
        }

        const resData = await response.json();
        console.log(`[${config.nodeName}] Report synced successfully: ${JSON.stringify(resData)}`);
        return resData;
      },
      {
        connection: connectionOpts,
        limiter: {
          max: 1,
          duration: 1000,
        },
      }
    );

    worker.on("failed", (job, err) => {
      console.error(`[${config.nodeName}] Job ${job?.id} failed: ${err.message}`);
    });

    // Register repeatable daily cron job at 23:59
    queue.add(
      "sync-report-daily",
      {},
      {
        repeat: {
          pattern: "59 23 * * *",
        },
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    ).catch((err) => {
      console.error(`[${config.nodeName}] Failed to register daily cron job:`, err);
    });
    console.log(`[${config.nodeName}] Registered daily cron job sync-report-daily for 23:59.`);
  }

  if (config.nodeRole === "central") {
    const violationStartTimes: Record<string, number> = {};

    monitoringIntervalId = setInterval(async () => {
      try {
        const results = await prisma.$queryRaw<
          { slot_name: string; active: boolean; state: string | null; lag_seconds: number | null }[]
        >`
          SELECT 
            s.slot_name,
            s.active,
            r.state,
            COALESCE(EXTRACT(EPOCH FROM r.replay_lag), 0) as lag_seconds
          FROM pg_replication_slots s
          LEFT JOIN pg_stat_replication r ON s.slot_name = r.application_name
        `;

        for (const row of results) {
          const slotName = row.slot_name;
          const active = row.active;
          const state = row.state;
          const lag = Number(row.lag_seconds ?? 0);

          const branchSlug = slotName.replace("lc_", "").replace("_sub", "");
          const slaLimit = REPLICATION_LAG_ALERT_SECONDS[branchSlug as BranchSlug] ?? 5;

          const isViolating = !active || state !== "streaming" || lag > slaLimit;

          if (isViolating) {
            if (!violationStartTimes[slotName]) {
              violationStartTimes[slotName] = Date.now();
              console.warn(
                `[${config.nodeName}] SLA violation detected on ${slotName} (Active: ${active}, State: ${state}, Lag: ${lag}s). Starting 2-minute alert window.`
              );
            } else {
              const durationSeconds = Math.round((Date.now() - violationStartTimes[slotName]) / 1000);
              if (durationSeconds > 120) {
                console.error(
                  `[ALERT] SLA VIOLATION! Replication ${slotName} is failing. SLA: ${slaLimit}s, Current Lag: ${lag}s. Out of SLA for ${durationSeconds} seconds continuously.`
                );
              } else {
                console.warn(
                  `[${config.nodeName}] SLA violation ongoing on ${slotName}. Lag: ${lag}s. Out of SLA for ${durationSeconds}/120 seconds.`
                );
              }
            }
          } else {
            if (violationStartTimes[slotName]) {
              console.log(
                `[${config.nodeName}] SLA violation resolved on ${slotName} after ${Math.round(
                  (Date.now() - violationStartTimes[slotName]) / 1000
                )} seconds. System is healthy.`
              );
              delete violationStartTimes[slotName];
            }
          }
        }
      } catch (err) {
        console.error(`[${config.nodeName}] Failed to execute replication SLA health check:`, err);
      }
    }, 30000);

    console.log(`[${config.nodeName}] Replication SLA monitoring initialized (Interval: 30s).`);
  }

  async function resolveBranchId() {
    const branch = await prisma.branch.findUnique({
      where: { code: config.branchSlug },
    });

    if (!branch) {
      throw new Error(`Branch ${config.branchSlug} not found.`);
    }

    return branch.id;
  }

  io = new SocketIOServer({
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    const branchSlug = socket.handshake.query.branchSlug as string || config.branchSlug;
    const roomName = `branch:${branchSlug}`;
    void socket.join(roomName);
    console.log(`[${config.nodeName}] Socket connected: ${socket.id}, joined room: ${roomName}`);

    socket.on("disconnect", () => {
      console.log(`[${config.nodeName}] Socket disconnected: ${socket.id}`);
    });
  });

  broadcastBranchEvent = (branchSlug: string, eventName: string, payload: unknown) => {
    if (io) {
      const roomName = `branch:${branchSlug}`;
      io.to(roomName).emit(eventName, payload);
      console.log(`[${config.nodeName}] Broadcasted event '${eventName}' to room '${roomName}'`);
    }
  };

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    try {
      routeWritePolicy(
        config.nodeRole,
        requestUrl.pathname,
        request.method ?? "GET",
      );

      if (requestUrl.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          node: config.nodeName,
          nodeRole: config.nodeRole,
          branchSlug: config.branchSlug,
        });
        return;
      }

      if (requestUrl.pathname === "/meta/classification") {
        sendJson(response, 200, {
          globalTables: GLOBAL_TABLES,
          localTables: LOCAL_TABLES,
          lagAlertSeconds: REPLICATION_LAG_ALERT_SECONDS,
        });
        return;
      }

      if (requestUrl.pathname === "/db/ping") {
        await prisma.$queryRaw`SELECT 1`;
        sendJson(response, 200, {
          ok: true,
          database: "reachable",
          nodeRole: config.nodeRole,
        });
        return;
      }

      if (requestUrl.pathname === "/db/global/menus") {
        const cacheKey = "lc:global:menus";
        const fallbackKey = "lc:global:menus:fallback";

        if (redisClient) {
          try {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
              const menus = JSON.parse(cachedData);
              sendJson(response, 200, { menus, source: "cache" });
              return;
            }
          } catch (redisErr) {
            console.error(`[${config.nodeName}] Redis read error:`, redisErr);
          }
        }

        try {
          const menus = await prisma.menu.findMany({
            orderBy: [{ name: "asc" }],
            include: {
              category: true,
              priceMaster: true,
            },
          });

          if (redisClient) {
            try {
              const dataStr = JSON.stringify(menus);
              await redisClient.set(cacheKey, dataStr, "EX", 60);
              await redisClient.set(fallbackKey, dataStr);
            } catch (redisErr) {
              console.error(`[${config.nodeName}] Redis write error:`, redisErr);
            }
          }

          sendJson(response, 200, { menus, source: "database" });
          return;
        } catch (dbErr) {
          console.error(`[${config.nodeName}] Database query failed, attempting cache fallback:`, dbErr);

          if (redisClient) {
            try {
              const fallbackData = await redisClient.get(fallbackKey);
              if (fallbackData) {
                const menus = JSON.parse(fallbackData);
                sendJson(response, 200, {
                  menus,
                  source: "fallback_cache",
                  error: "Database offline",
                });
                return;
              }
            } catch (redisErr) {
              console.error(`[${config.nodeName}] Redis fallback read error:`, redisErr);
            }
          }

          throw dbErr;
        }
      }

      if (requestUrl.pathname === "/db/local/tables") {
        const tables = await prisma.diningTable.findMany({
          where: {
            branch: {
              code: config.branchSlug,
            },
          },
          orderBy: [{ tableNumber: "asc" }],
          include: {
            branch: true,
          },
        });

        sendJson(response, 200, { tables });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/orders" &&
        (request.method ?? "GET") === "POST"
      ) {
        const body = await readJsonBody(request);
        const tableId = asString(body.tableId);
        const items = Array.isArray(body.items) ? body.items : [];
        const notes = asString(body.notes);

        if (!tableId || items.length === 0) {
          sendJson(response, 400, {
            error: "tableId and items are required.",
          });
          return;
        }

        const branchId = await resolveBranchId();
        const table = await prisma.diningTable.findFirst({
          where: {
            id: tableId,
            branchId,
          },
        });

        if (!table) {
          sendJson(response, 404, {
            error: "Table not found for current branch.",
          });
          return;
        }

        const menuIds = asStringArray(
          items.map((item) => (item as { menuId?: unknown }).menuId),
        );
        const menus = await prisma.menu.findMany({
          where: {
            id: { in: menuIds },
          },
          include: {
            priceMaster: true,
            priceOverrides: {
              where: { branchId },
            },
          },
        });

        if (menus.length !== menuIds.length) {
          sendJson(response, 400, {
            error: "One or more menuId values are invalid.",
          });
          return;
        }

        const orderItems = items.map((item) => {
          const menuId = asString((item as { menuId?: unknown }).menuId);
          const quantity = asNumber((item as { quantity?: unknown }).quantity);

          if (!menuId || quantity === null || quantity <= 0) {
            throw new Error("Each item must contain menuId and quantity > 0.");
          }

          const menu = menus.find((entry) => entry.id === menuId);
          if (!menu || !menu.priceMaster) {
            throw new Error(`Menu price master missing for ${menuId}.`);
          }

          const override = menu.priceOverrides[0]?.overridePrice;
          const unitPrice = resolveEffectiveMenuPrice(
            Number(menu.priceMaster.basePrice),
            override ? Number(override) : null,
          );

          return {
            menu: { connect: { id: menuId } },
            quantity,
            unitPrice,
            lineTotal: unitPrice * quantity,
            specialNote:
              asString((item as { specialNote?: unknown }).specialNote) ??
              null,
          };
        });

        const subtotal = orderItems.reduce(
          (sum, item) => sum + item.lineTotal,
          0,
        );
        const tax = Math.round(subtotal * 0.11 * 100) / 100;
        const grandTotal = subtotal + tax;
        const orderNumber = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const order = await prisma.$transaction(async (transaction) => {
          const createdOrder = await transaction.order.create({
            data: {
              branchId,
              tableId,
              orderNumber,
              notes: notes ?? null,
              subtotal,
              tax,
              grandTotal,
              items: {
                create: orderItems,
              },
            },
            include: {
              items: true,
            },
          });

          return createdOrder;
        });

        // Broadcast WebSocket event
        broadcastBranchEvent(config.branchSlug, "order_created", { order });

        sendJson(response, 201, { order });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/menu-price-overrides" &&
        (request.method ?? "GET") === "POST"
      ) {
        const body = await readJsonBody(request);
        const menuId = asString(body.menuId);
        const overridePrice = asNumber(body.overridePrice);
        const reason = asString(body.reason);

        if (!menuId || overridePrice === null) {
          sendJson(response, 400, {
            error: "menuId and overridePrice are required.",
          });
          return;
        }

        const branchId = await resolveBranchId();
        const override = await prisma.menuPriceOverride.upsert({
          where: {
            branchId_menuId: {
              branchId,
              menuId,
            },
          },
          create: {
            branchId,
            menuId,
            overridePrice,
            reason: reason ?? null,
          },
          update: {
            overridePrice,
            reason: reason ?? null,
          },
        });

        sendJson(response, 201, { override });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/menu-price-overrides" &&
        (request.method ?? "GET") === "DELETE"
      ) {
        const body = await readJsonBody(request);
        const menuId = asString(body.menuId);

        if (!menuId) {
          sendJson(response, 400, { error: "menuId is required." });
          return;
        }

        const branchId = await resolveBranchId();
        await prisma.menuPriceOverride.deleteMany({
          where: {
            branchId,
            menuId,
          },
        });

        sendJson(response, 200, { ok: true, message: "Price override deleted." });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/trigger-daily-report" &&
        (request.method ?? "GET") === "POST"
      ) {
        if (config.nodeRole !== "branch") {
          sendJson(response, 400, {
            error: "Triggering daily report aggregation is only supported on branch nodes.",
          });
          return;
        }

        const body = await readJsonBody(request);
        let reportDate = asString(body.reportDate);
        if (!reportDate) {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, "0");
          const day = String(today.getDate()).padStart(2, "0");
          reportDate = `${year}-${month}-${day}`;
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(reportDate)) {
          sendJson(response, 400, {
            error: "reportDate must be in YYYY-MM-DD format.",
          });
          return;
        }

        if (!queue) {
          sendJson(response, 500, {
            error: "Daily report queue is not initialized.",
          });
          return;
        }

        const job = await queue.add(
          "sync-report",
          { reportDate },
          {
            attempts: 5,
            backoff: {
              type: "exponential",
              delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          }
        );

        sendJson(response, 202, {
          message: `Daily report job queued for date ${reportDate}.`,
          jobId: job.id,
        });
        return;
      }

      if (
        requestUrl.pathname === "/api/central/reports" &&
        (request.method ?? "GET") === "POST"
      ) {
        ensureCentralWriteAccess(config.nodeRole);

        const body = await readJsonBody(request);
        const branchCode = asString(body.branchCode);
        const reportDate = parseDateOnly(asString(body.reportDate));
        const totalOrders = asNumber(body.totalOrders);
        const totalItemsSold = asNumber(body.totalItemsSold);
        const grossSales = asNumber(body.grossSales);
        const netSales = asNumber(body.netSales);
        const paymentCount = asNumber(body.paymentCount);

        if (
          !branchCode ||
          !reportDate ||
          totalOrders === null ||
          totalItemsSold === null ||
          grossSales === null ||
          netSales === null ||
          paymentCount === null
        ) {
          sendJson(response, 400, {
            error:
              "branchCode, reportDate, totalOrders, totalItemsSold, grossSales, netSales, and paymentCount are required.",
          });
          return;
        }

        const branch = await prisma.branch.findUnique({
          where: { code: branchCode },
        });
        if (!branch) {
          sendJson(response, 404, { error: "Branch not found." });
          return;
        }

        const report = await prisma.dailyReportAggregate.upsert({
          where: {
            branchId_reportDate: {
              branchId: branch.id,
              reportDate,
            },
          },
          create: {
            branchId: branch.id,
            reportDate,
            totalOrders,
            totalItemsSold,
            grossSales,
            netSales,
            paymentCount,
            source: body.source === "MANUAL_FIX" ? "MANUAL_FIX" : "REST_SYNC",
            submittedAt: new Date(),
          },
          update: {
            totalOrders,
            totalItemsSold,
            grossSales,
            netSales,
            paymentCount,
            source: body.source === "MANUAL_FIX" ? "MANUAL_FIX" : "REST_SYNC",
            submittedAt: new Date(),
          },
        });

        sendJson(response, 201, { report });
        return;
      }

      if (
        requestUrl.pathname === "/api/central/replication-status" &&
        (request.method ?? "GET") === "GET"
      ) {
        if (config.nodeRole !== "central") {
          sendJson(response, 400, {
            error: "Replication status is only supported on central node.",
          });
          return;
        }

        const results = await prisma.$queryRaw<
          { slot_name: string; active: boolean; state: string | null; lag_seconds: number | null }[]
        >`
          SELECT 
            s.slot_name,
            s.active,
            r.state,
            COALESCE(EXTRACT(EPOCH FROM r.replay_lag), 0) as lag_seconds
          FROM pg_replication_slots s
          LEFT JOIN pg_stat_replication r ON s.slot_name = r.application_name
        `;

        const statuses = results.map((row) => {
          const slotName = row.slot_name;
          const active = row.active;
          const state = row.state;
          const lag = Number(row.lag_seconds ?? 0);

          const branchSlug = slotName.replace("lc_", "").replace("_sub", "");
          const slaLimit = REPLICATION_LAG_ALERT_SECONDS[branchSlug as BranchSlug] ?? 5;

          const isViolating = !active || state !== "streaming" || lag > slaLimit;

          return {
            slotName,
            branchSlug,
            active,
            state,
            currentLagSeconds: lag,
            slaLimitSeconds: slaLimit,
            isViolating,
          };
        });

        sendJson(response, 200, {
          ok: true,
          node: config.nodeName,
          replicationSlots: statuses,
        });
        return;
      }

      if (requestUrl.pathname === "/pricing/effective") {
        const basePrice = parseNumber(requestUrl.searchParams.get("basePrice"));
        const overridePrice = parseNumber(
          requestUrl.searchParams.get("overridePrice"),
        );

        if (basePrice === null) {
          sendJson(response, 400, {
            error: "basePrice is required and must be numeric.",
          });
          return;
        }

        sendJson(response, 200, {
          effectivePrice: resolveEffectiveMenuPrice(basePrice, overridePrice),
          basePrice,
          overridePrice,
        });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/payments" &&
        (request.method ?? "GET") === "POST"
      ) {
        const body = await readJsonBody(request);
        const orderId = asString(body.orderId);

        if (!orderId) {
          sendJson(response, 400, { error: "orderId is required." });
          return;
        }

        const branchId = await resolveBranchId();
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { payment: true },
        });

        if (!order) {
          sendJson(response, 404, { error: "Order not found." });
          return;
        }

        if (order.branchId !== branchId) {
          sendJson(response, 403, { error: "Order does not belong to this branch." });
          return;
        }

        if (order.payment) {
          if (order.payment.status === "PAID") {
            sendJson(response, 400, { error: "Order is already paid." });
            return;
          }
          const mockQrisData = `00020101021226640014ID.CO.QRIS.WWW0215ID10202607031120303035504000053033605405${Math.round(Number(order.grandTotal))}5802ID5913Letter Coffee6007Jakarta6304`;
          const qrisUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mockQrisData)}`;
          sendJson(response, 200, {
            payment: order.payment,
            qrisUrl,
            qrisData: mockQrisData,
          });
          return;
        }

        const mockQrisData = `00020101021226640014ID.CO.QRIS.WWW0215ID10202607031120303035504000053033605405${Math.round(Number(order.grandTotal))}5802ID5913Letter Coffee6007Jakarta6304`;
        const qrisUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mockQrisData)}`;

        const payment = await prisma.payment.create({
          data: {
            orderId,
            method: "QRIS",
            amount: order.grandTotal,
            status: "PENDING",
            externalRef: `MOCK-REF-${Date.now()}`,
          },
        });

        sendJson(response, 201, {
          payment,
          qrisUrl,
          qrisData: mockQrisData,
        });
        return;
      }

      if (
        requestUrl.pathname === "/api/webhooks/payment" &&
        (request.method ?? "GET") === "POST"
      ) {
        const rawBody = await readRawBody(request);
        const body = JSON.parse(rawBody);

        const orderId = asString(body.orderId);
        const status = asString(body.status);
        const externalRef = asString(body.externalRef);

        if (!orderId || !status) {
          sendJson(response, 400, { error: "orderId and status are required." });
          return;
        }

        const signature = request.headers["x-callback-signature"];
        const secretKey = process.env.PAYMENT_WEBHOOK_SECRET || "lc_secret_key";
        const expectedSignature = crypto
          .createHmac("sha512", secretKey)
          .update(rawBody)
          .digest("hex");

        if (signature !== expectedSignature) {
          sendJson(response, 401, { error: "Invalid HMAC-SHA512 webhook signature." });
          return;
        }

        const branchId = await resolveBranchId();
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { payment: true },
        });

        if (!order) {
          sendJson(response, 404, { error: "Order not found." });
          return;
        }

        if (order.branchId !== branchId) {
          sendJson(response, 403, { error: "Order does not belong to this branch." });
          return;
        }

        if (!order.payment) {
          sendJson(response, 400, { error: "Payment not initialized for this order." });
          return;
        }

        if (order.payment.status === "PAID") {
          sendJson(response, 200, { ok: true, message: "Payment was already processed as PAID." });
          return;
        }

        const isPaid = status === "PAID";
        const updatedPayment = await prisma.payment.update({
          where: { id: order.payment.id },
          data: {
            status: isPaid ? "PAID" : "FAILED",
            externalRef: externalRef ?? order.payment.externalRef,
            paidAt: isPaid ? new Date() : null,
          },
        });

        const updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            status: isPaid ? "CONFIRMED" : "PENDING",
          },
        });

        if (isPaid) {
          broadcastBranchEvent(config.branchSlug, "order_paid", {
            orderId,
            status: "CONFIRMED",
          });
          broadcastBranchEvent(config.branchSlug, "payment_confirmed", {
            orderId,
            status: "PAID",
            paymentId: updatedPayment.id,
          });
        }

        sendJson(response, 200, {
          ok: true,
          message: "Payment processed successfully.",
          paymentStatus: updatedPayment.status,
          orderStatus: updatedOrder.status,
        });
        return;
      }

      if (
        requestUrl.pathname === "/db/local/orders/status" &&
        (request.method ?? "GET") === "POST"
      ) {
        const body = await readJsonBody(request);
        const orderId = asString(body.orderId);
        const status = asString(body.status);

        if (!orderId || !status) {
          sendJson(response, 400, { error: "orderId and status are required." });
          return;
        }

        const validStatuses = [
          "PENDING",
          "CONFIRMED",
          "PREPARING",
          "READY",
          "SERVED",
          "COMPLETED",
          "CANCELLED",
        ];
        if (!validStatuses.includes(status)) {
          sendJson(response, 400, { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
          return;
        }

        const branchId = await resolveBranchId();
        const order = await prisma.order.findUnique({
          where: { id: orderId },
        });

        if (!order) {
          sendJson(response, 404, { error: "Order not found." });
          return;
        }

        if (order.branchId !== branchId) {
          sendJson(response, 403, { error: "Order does not belong to this branch." });
          return;
        }

        const updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            status: status as any,
            completedAt: status === "COMPLETED" ? new Date() : order.completedAt,
          },
        });

        broadcastBranchEvent(config.branchSlug, "order_status_updated", {
          orderId,
          status: updatedOrder.status,
        });

        sendJson(response, 200, {
          ok: true,
          order: updatedOrder,
        });
        return;
      }

      if (requestUrl.pathname === "/admin/global/write-test") {
        sendJson(response, 200, {
          ok: true,
          message: "Global write access permitted on central node.",
        });
        return;
      }

      sendJson(response, 404, {
        error: "Route not found",
        node: config.nodeName,
      });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode ?? 500)
          : 500;

      sendJson(response, statusCode, {
        error:
          error instanceof Error ? error.message : "Unexpected server error",
      });
    }
  });

  const shutdown = async () => {
    if (monitoringIntervalId) {
      clearInterval(monitoringIntervalId);
    }
    if (worker) {
      try { await worker.close(); } catch (e) {}
    }
    if (queue) {
      try { await queue.close(); } catch (e) {}
    }
    if (redisClient) {
      try { await redisClient.quit(); } catch (e) {}
    }
    if (io) {
      try { io.close(); } catch (e) {}
    }
    await prisma.$disconnect();
    server.close();
  };

  server.on("close", () => {
    if (monitoringIntervalId) { clearInterval(monitoringIntervalId); }
    if (worker) { void worker.close(); }
    if (queue) { void queue.close(); }
    if (redisClient) { void redisClient.quit(); }
    if (io) { void io.close(); }
    void prisma.$disconnect();
  });

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });

  if (io) {
    io.attach(server);
  }

  await new Promise<void>((resolve) => {
    server.listen(config.port, resolve);
  });

  console.log(
    `[${config.nodeName}] listening on port ${config.port} (${config.nodeRole}/${config.branchSlug})`,
  );

  return server;
}
