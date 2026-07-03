import crypto from "crypto";

const CENTRAL_DB_URL = "postgresql://postgres:postgres@localhost:5432/lettercoffee?connection_limit=100";
const BRANCH_URL = "http://localhost:3002"; // Tasikmalaya Branch
const HMAC_SECRET = "lc_secret_key";

async function runVerify() {
  console.log("=== STARTING DAILY REPORT SYNC VERIFICATION ===");

  try {
    // 1. Fetch tables
    console.log(`1. Fetching tables from ${BRANCH_URL}/db/local/tables...`);
    const tablesRes = await fetch(`${BRANCH_URL}/db/local/tables`);
    const tablesData = await tablesRes.json();
    if (!tablesData.tables || tablesData.tables.length === 0) {
      throw new Error("No tables found for this branch.");
    }
    const tableId = tablesData.tables[0].id;
    console.log(`   Table selected: ${tablesData.tables[0].tableNumber}`);

    // 2. Fetch menus
    console.log(`2. Fetching menus from ${BRANCH_URL}/db/global/menus...`);
    const menusRes = await fetch(`${BRANCH_URL}/db/global/menus`);
    const menusData = await menusRes.json();
    if (!menusData.menus || menusData.menus.length === 0) {
      throw new Error("No menus found in database.");
    }
    const menuId = menusData.menus[0].id;
    console.log(`   Menu selected: ${menusData.menus[0].name}`);

    // 3. Create a test order
    console.log("3. Creating a test order on branch...");
    const orderPayload = {
      tableId,
      items: [
        {
          menuId,
          quantity: 2,
        },
      ],
      notes: "Verification test order",
    };
    const orderRes = await fetch(`${BRANCH_URL}/db/local/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.order) {
      throw new Error(`Failed to create order: ${JSON.stringify(orderData)}`);
    }
    const orderId = orderData.order.id;
    const grandTotal = Number(orderData.order.grandTotal);
    console.log(`   Order created successfully: ID=${orderId}, GrandTotal=Rp${grandTotal}`);

    // 3b. Initialize payment
    console.log("3b. Initializing payment...");
    const initPaymentRes = await fetch(`${BRANCH_URL}/db/local/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const initPaymentData = await initPaymentRes.json();
    if (!initPaymentRes.ok) {
      throw new Error(`Failed to initialize payment: ${JSON.stringify(initPaymentData)}`);
    }
    console.log("    Payment initialized successfully.");

    // 4. Pay the order using the signature webhook
    console.log("4. Triggering payment webhook to confirm order...");
    const paymentPayload = {
      orderId,
      status: "PAID",
      externalRef: `VERIFY-REF-${Date.now()}`,
    };
    const rawBody = JSON.stringify(paymentPayload);
    const signature = crypto.createHmac("sha512", HMAC_SECRET).update(rawBody).digest("hex");

    const webhookRes = await fetch(`${BRANCH_URL}/api/webhooks/payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-callback-signature": signature,
      },
      body: rawBody,
    });
    const webhookData = await webhookRes.json();
    if (!webhookRes.ok) {
      throw new Error(`Webhook failed: ${JSON.stringify(webhookData)}`);
    }
    console.log("   Webhook processed successfully.");

    // 5. Trigger the daily report aggregation for today's date
    const todayStr = new Date().toISOString().split("T")[0];
    console.log(`5. Triggering daily report sync for date: ${todayStr}...`);
    const triggerRes = await fetch(`${BRANCH_URL}/db/local/trigger-daily-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportDate: todayStr }),
    });
    const triggerData = await triggerRes.json();
    if (!triggerRes.ok) {
      throw new Error(`Failed to trigger daily report: ${JSON.stringify(triggerData)}`);
    }
    console.log(`   Job queued successfully: ID=${triggerData.jobId}`);

    // 6. Wait for BullMQ job execution (exponential backoff / rest post takes < 1s)
    console.log("6. Waiting 3 seconds for BullMQ to process the async report sync job...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 7. Directly query central DB pg_stat or query daily_reports_aggregate
    console.log("7. Querying central database (db-pusat) for verification...");
    // Let's call the psql command via docker-compose since we don't have a direct postgres npm package
    const checkQuery = `SELECT * FROM daily_reports_aggregate WHERE report_date = '${todayStr}';`;
    const { execSync } = await import("child_process");
    const output = execSync(`docker compose exec -T db-pusat psql -U postgres -d lettercoffee -c "${checkQuery}"`, { encoding: "utf-8" });
    console.log("\n--- CENTRAL DATABASE RESULT ---");
    console.log(output);
    console.log("-------------------------------\n");

    if (output.includes("tasikmalaya") || output.includes("00000000-0000-0000-0000-000000000002") || output.includes("REST_SYNC")) {
      console.log("🎉 SUCCESS: Daily report successfully aggregated at branch and synced to db-pusat!");
    } else {
      console.log("❌ FAILURE: No matching daily report aggregate found in db-pusat.");
    }

  } catch (err) {
    console.error("Verification failed with error:", err.message);
  }
}

runVerify();
