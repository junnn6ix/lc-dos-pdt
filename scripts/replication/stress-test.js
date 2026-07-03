const branch = process.argv[2];
const concurrencyStr = process.argv[3] || "100";

const CONFIGS = {
  tasikmalaya: { port: 3002, label: "Tasikmalaya (Local/HQ)", targetP95: 300 },
  surabaya: { port: 3003, label: "Surabaya (Remote)", targetP95: 500 },
  malang: { port: 3004, label: "Malang (Remote Onboarded)", targetP95: 500 },
};

if (!branch || !CONFIGS[branch]) {
  console.log("Usage: node scripts/replication/stress-test.js [tasikmalaya|surabaya|malang] [concurrency=100]");
  process.exit(1);
}

const config = CONFIGS[branch];
const concurrency = parseInt(concurrencyStr, 10);
const url = `http://localhost:${config.port}`;

async function main() {
  console.log(`=== STRESS TEST FOR BRANCH: ${config.label} ===`);
  console.log(`Target Concurrency: ${concurrency} orders`);
  console.log(`Target P95 Response Latency: < ${config.targetP95} ms\n`);

  try {
    // 1. Fetch tables
    console.log(`1. Fetching tables from ${url}/db/local/tables...`);
    const tablesRes = await fetch(`${url}/db/local/tables`);
    const tablesData = await tablesRes.json();
    if (!tablesData.tables || tablesData.tables.length === 0) {
      throw new Error("No tables found for this branch.");
    }
    const tableId = tablesData.tables[0].id;
    const tableNum = tablesData.tables[0].tableNumber;
    console.log(`   Selected Table: ${tableNum} (ID: ${tableId})`);

    // 2. Fetch menus
    console.log(`2. Fetching menus from ${url}/db/global/menus...`);
    const menusRes = await fetch(`${url}/db/global/menus`);
    const menusData = await menusRes.json();
    if (!menusData.menus || menusData.menus.length === 0) {
      throw new Error("No menus found in database.");
    }
    const menu = menusData.menus[0];
    const menuId = menu.id;
    const menuName = menu.name;
    const basePrice = Number(menu.priceMaster?.basePrice || 0);
    console.log(`   Selected Menu: ${menuName} (ID: ${menuId}, Base Price: Rp${basePrice})`);

    // 3. Create a Local Price Override
    const overridePrice = basePrice + 3000; // e.g. Rp22,000 -> Rp25,000
    console.log(`3. Setting local price override on ${menuName} to Rp${overridePrice}...`);
    const overrideRes = await fetch(`${url}/db/local/menu-price-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menuId,
        overridePrice,
        reason: "Stress test price override",
      }),
    });
    const overrideData = await overrideRes.json();
    if (!overrideRes.ok) {
      throw new Error(`Failed to set price override: ${overrideData.error}`);
    }
    console.log(`   Price override successfully set.`);

    // 4. Run Concurrent Order Requests
    console.log(`4. Launching ${concurrency} concurrent order requests...`);
    
    // Prepare request body
    const orderPayload = {
      tableId,
      items: [
        {
          menuId,
          quantity: 2, // 2 items x overridePrice (Rp25,000) = Rp50,000. With 11% tax = Rp55,500
        },
      ],
      notes: "Stress test request",
    };

    const latencies = [];
    let successCount = 0;
    let failCount = 0;
    let overrideVerified = false;
    let verifiedGrandTotal = 0;

    const startTotalTime = performance.now();

    const requests = Array.from({ length: concurrency }).map(async (_, idx) => {
      const startReqTime = performance.now();
      try {
        const res = await fetch(`${url}/db/local/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        });
        const reqDuration = performance.now() - startReqTime;
        latencies.push(reqDuration);

        const data = await res.json();
        if (res.status === 201 && data.order) {
          successCount++;
          // Verify price override on the first success
          if (!overrideVerified) {
            const grandTotal = Number(data.order.grandTotal);
            const expectedTotal = (overridePrice * 2) * 1.11; // subtotal * tax
            // Let's compare mathematically
            if (Math.abs(grandTotal - expectedTotal) < 1) {
              overrideVerified = true;
            }
            verifiedGrandTotal = grandTotal;
          }
        } else {
          failCount++;
        }
      } catch (err) {
        const reqDuration = performance.now() - startReqTime;
        latencies.push(reqDuration);
        failCount++;
      }
    });

    await Promise.all(requests);
    const totalDuration = performance.now() - startTotalTime;

    // 5. Cleanup Price Override
    console.log(`5. Cleaning up local price override...`);
    const cleanupRes = await fetch(`${url}/db/local/menu-price-overrides`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menuId }),
    });
    const cleanupData = await cleanupRes.json();
    if (cleanupRes.ok) {
      console.log(`   Price override successfully cleaned up.`);
    } else {
      console.log(`   Warning: Failed to cleanup price override: ${cleanupData.error}`);
    }

    // 6. Process Metrics
    const avgLatency = latencies.reduce((sum, val) => sum + val, 0) / latencies.length;
    latencies.sort((a, b) => a - b);
    const minLatency = latencies[0];
    const maxLatency = latencies[latencies.length - 1];
    
    // Percentiles
    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Idx];
    const p99Idx = Math.floor(latencies.length * 0.99);
    const p99Latency = latencies[p99Idx];

    const throughput = (successCount / (totalDuration / 1000)).toFixed(2);

    console.log("\n" + "="*50);
    console.log(`STRESS TEST RESULTS - ${config.label}`);
    console.log("="*50);
    console.log(`Total Requests:         ${concurrency}`);
    console.log(`Successful Orders:      ${successCount}`);
    console.log(`Failed Orders:          ${failCount}`);
    console.log(`Total Time Elapsed:     ${(totalDuration / 1000).toFixed(3)} seconds`);
    console.log(`Throughput:             ${throughput} req/sec`);
    console.log(`Minimum Latency:        ${minLatency.toFixed(2)} ms`);
    console.log(`Maximum Latency:        ${maxLatency.toFixed(2)} ms`);
    console.log(`Average Latency:        ${avgLatency.toFixed(2)} ms`);
    console.log(`P95 Latency:            ${p95Latency.toFixed(2)} ms`);
    console.log(`P99 Latency:            ${p99Latency.toFixed(2)} ms`);
    console.log(`Price Override Verification: ${verifiedGrandTotal ? "SUCCESS (Grand Total: Rp" + verifiedGrandTotal + ")" : "FAILED"}`);
    console.log("="*50);

    const meetsSla = p95Latency < config.targetP95;
    if (meetsSla) {
      console.log(`🎉 SLA MET! P95 Latency (${p95Latency.toFixed(2)}ms) is under target limit of ${config.targetP95}ms.`);
    } else {
      console.log(`❌ SLA VIOLATION! P95 Latency (${p95Latency.toFixed(2)}ms) exceeded target limit of ${config.targetP95}ms.`);
    }
    console.log("="*50);

  } catch (err) {
    console.error("Stress test interrupted by error:", err.message);
    process.exit(1);
  }
}

main();
