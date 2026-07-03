import { io } from "socket.io-client";
import crypto from "node:crypto";

const command = process.argv[2];
const branch = process.argv[3];

const CONFIGS = {
  tasikmalaya: { port: 3002 },
  surabaya: { port: 3003 },
};

if (!command || !branch || !CONFIGS[branch]) {
  console.log("Usage:");
  console.log("  node scripts/replication/test-payment.js listener [tasikmalaya|surabaya]");
  console.log("  node scripts/replication/test-payment.js webhook [tasikmalaya|surabaya] <orderId> <amount>");
  process.exit(1);
}

const config = CONFIGS[branch];
const url = `http://localhost:${config.port}`;

if (command === "listener") {
  console.log(`Connecting to Socket.io on ${url} for branch: ${branch}...`);
  const socket = io(url, {
    query: { branchSlug: branch },
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    console.log(`Successfully connected! Socket ID: ${socket.id}`);
  });

  socket.on("order_created", (data) => {
    console.log("\n[EVENT] order_created received:");
    console.log(JSON.stringify(data, null, 2));
  });

  socket.on("order_paid", (data) => {
    console.log("\n[EVENT] order_paid received:");
    console.log(JSON.stringify(data, null, 2));
  });

  socket.on("payment_confirmed", (data) => {
    console.log("\n[EVENT] payment_confirmed received:");
    console.log(JSON.stringify(data, null, 2));
  });

  socket.on("order_status_updated", (data) => {
    console.log("\n[EVENT] order_status_updated received:");
    console.log(JSON.stringify(data, null, 2));
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected.");
  });
} else if (command === "webhook") {
  const orderId = process.argv[4];
  const amount = process.argv[5];

  if (!orderId || !amount) {
    console.log("Error: orderId and amount are required for webhook command.");
    process.exit(1);
  }

  const secretKey = process.env.PAYMENT_WEBHOOK_SECRET || "lc_secret_key";
  const payload = {
    orderId,
    status: "PAID",
    amount: Number(amount),
    paymentMethod: "QRIS",
    externalRef: `MOCK-TX-${Date.now()}`,
  };

  const bodyStr = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha512", secretKey)
    .update(bodyStr)
    .digest("hex");

  console.log(`Sending webhook to ${url}/api/webhooks/payment...`);
  console.log(`Payload: ${bodyStr}`);
  console.log(`Signature: ${signature}`);

  fetch(`${url}/api/webhooks/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-callback-signature": signature,
    },
    body: bodyStr,
  })
    .then(async (res) => {
      const data = await res.json();
      console.log(`Status Code: ${res.status}`);
      console.log("Response:", JSON.stringify(data, null, 2));
    })
    .catch((err) => {
      console.error("Request failed:", err);
    });
}
