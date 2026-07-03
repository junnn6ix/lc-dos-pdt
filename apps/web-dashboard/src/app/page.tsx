"use client";

import React, { useState, useEffect, useRef } from "react";

type ReplicationSlot = {
  branchSlug: string;
  slotName: string;
  active: boolean;
  state: string;
  currentLagSeconds: number;
  slaLimitSeconds: number;
};

type Menu = {
  id: string;
  sku: string;
  name: string;
  category?: { name: string };
  priceMaster?: { basePrice: number };
  priceOverrides?: Array<{ branchId: string; overridePrice: number; reason: string }>;
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  grandTotal: string;
  items: Array<{ quantity: number; menu?: { name: string } }>;
  payment?: { status: string };
};

type Table = {
  id: string;
  number: string;
};

const CONFIGS: Record<string, { port: number; label: string; tableNum: string }> = {
  tasikmalaya: { port: 3002, label: "Tasikmalaya (Local/HQ)", tableNum: "T-01" },
  surabaya: { port: 3003, label: "Surabaya (Remote)", tableNum: "S-01" },
  malang: { port: 3004, label: "Malang (Remote Onboarded)", tableNum: "M-01" },
};

export default function Home() {
  const [replicationSlots, setReplicationSlots] = useState<ReplicationSlot[]>([]);
  const [masterMenus, setMasterMenus] = useState<Menu[]>([]);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const [branchMenus, setBranchMenus] = useState<Menu[]>([]);
  const [branchOrders, setBranchOrders] = useState<Order[]>([]);
  const [isDbOffline, setIsDbOffline] = useState<boolean>(false);
  const [isRefreshingRep, setIsRefreshingRep] = useState(false);
  const [isRefreshingMenu, setIsRefreshingMenu] = useState(false);
  
  // Price override modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMenu, setModalMenu] = useState<Menu | null>(null);
  const [overridePriceInput, setOverridePriceInput] = useState<number>(0);
  const [overrideReasonInput, setOverrideReasonInput] = useState<string>("");

  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; type: "info" | "success" | "error" | "warning" }>>([]);
  const consoleRef = useRef<HTMLDivElement>(null);

  // Helper log
  const log = (text: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      { id: Math.random().toString(36).substring(2), time, text, type },
    ]);
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([{ id: "init", time: new Date().toLocaleTimeString(), text: "Console cleared.", type: "info" }]);
  };

  // Scroll console to bottom
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Load central data
  const fetchReplication = async (showLog = false) => {
    if (showLog) setIsRefreshingRep(true);
    try {
      const res = await fetch("http://localhost:3001/api/central/replication-status");
      if (!res.ok) throw new Error("Central server status check failed.");
      const data = await res.json();
      setReplicationSlots(data.replicationSlots || []);
      if (showLog) log("Successfully loaded replication status from db-pusat.", "success");
    } catch (err: any) {
      if (showLog) log(`Failed to fetch replication slots: ${err.message}`, "error");
    } finally {
      if (showLog) setIsRefreshingRep(false);
    }
  };

  const fetchMasterMenus = async (showLog = false) => {
    if (showLog) setIsRefreshingMenu(true);
    try {
      const res = await fetch("http://localhost:3001/db/global/menus");
      if (!res.ok) throw new Error("Central catalog load failed.");
      const data = await res.json();
      setMasterMenus(data.menus || []);
      if (showLog) log("Successfully loaded central master catalog.", "success");
    } catch (err: any) {
      if (showLog) log(`Failed to load master menus: ${err.message}`, "error");
    } finally {
      if (showLog) setIsRefreshingMenu(false);
    }
  };

  // Init fetch and auto-poll
  useEffect(() => {
    log("Distributed Cluster Dashboard Initialized.");
    void fetchReplication(true);
    void fetchMasterMenus(true);

    const interval = setInterval(() => {
      void fetchReplication(false);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Fetch branch data
  const fetchBranchData = async (branch: string) => {
    const config = CONFIGS[branch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    try {
      // Check branch ping
      let dbOnline = true;
      try {
        const pingRes = await fetch(`${url}/db/ping`);
        if (!pingRes.ok) dbOnline = false;
      } catch {
        dbOnline = false;
      }
      setIsDbOffline(!dbOnline);

      // Fetch menus
      const menusRes = await fetch(`${url}/db/global/menus`);
      const menusData = await menusRes.json();
      setBranchMenus(menusData.menus || []);
      const source = menusData.source || "live";
      if (source === "fallback_cache") {
        log(`[${branch.toUpperCase()}] Offline cache fallback (Redis) active!`, "warning");
      }

      // Fetch orders
      try {
        const ordersRes = await fetch(`${url}/db/local/orders/all-recent`);
        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          setBranchOrders(ordersData.orders || []);
        } else {
          setBranchOrders([]);
        }
      } catch {
        setBranchOrders([]);
      }

    } catch (err: any) {
      log(`[${branch.toUpperCase()}] Fetch error: ${err.message}`, "error");
    }
  };

  useEffect(() => {
    if (activeBranch) {
      void fetchBranchData(activeBranch);
    }
  }, [activeBranch]);

  // Edit master price
  const handleEditMasterPrice = async (menuId: string, name: string, currentPrice: number) => {
    const newPriceStr = prompt(`Masukkan harga dasar baru untuk ${name} (Base Price):`, currentPrice.toString());
    if (newPriceStr === null) return;
    const newPrice = Number(newPriceStr);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert("Harga master harus bernilai numerik positif.");
      return;
    }

    log(`[Pusat] Sending master price update request for ${name} to Rp${newPrice}...`);
    try {
      const res = await fetch("http://localhost:3001/db/global/menus/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuId, basePrice: newPrice }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[Pusat] Successfully updated base price for ${name} to Rp${newPrice}! (Logical replication will broadcast this instantly)`, "success");
        void fetchMasterMenus();
        if (activeBranch) {
          void fetchBranchData(activeBranch);
        }
      } else {
        log(`[Pusat] Error updating master price: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to update base price: ${err.message}`, "error");
    }
  };

  // Price overrides
  const openOverrideModal = (menu: Menu) => {
    setModalMenu(menu);
    const basePrice = menu.priceMaster?.basePrice || 0;
    setOverridePriceInput(basePrice + 2000);
    setOverrideReasonInput("Biaya logistik & operasional lokal");
    setModalOpen(true);
  };

  const submitPriceOverride = async () => {
    if (!activeBranch || !modalMenu) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Saving price override for ${modalMenu.name} to Rp${overridePriceInput}...`);
    try {
      const res = await fetch(`${url}/db/local/menu-price-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menuId: modalMenu.id,
          overridePrice: overridePriceInput,
          reason: overrideReasonInput,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Price override saved successfully!`, "success");
        setModalOpen(false);
        void fetchBranchData(activeBranch);
      } else {
        log(`Override Error: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to save price override: ${err.message}`, "error");
    }
  };

  const removePriceOverride = async (menuId: string, name: string) => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Deleting price override for ${name}...`);
    try {
      const res = await fetch(`${url}/db/local/menu-price-overrides`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuId }),
      });
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Price override deleted successfully!`, "success");
        void fetchBranchData(activeBranch);
      } else {
        log(`Failed to delete override.`, "error");
      }
    } catch (err: any) {
      log(`Failed to delete override: ${err.message}`, "error");
    }
  };

  // Transaction checkout
  const simulateCheckout = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Fetching components to build order...`);
    try {
      // Find local table T-01 / S-01 / M-01
      const tablesRes = await fetch(`${url}/db/local/tables`);
      const tablesData = await tablesRes.json();
      const tables = tablesData.tables || [];
      if (tables.length === 0) throw new Error("No tables found in this branch database.");
      const tableId = tables[0].id;

      // Select first menu id
      const firstMenu = branchMenus[0];
      if (!firstMenu) throw new Error("No menus found in this branch catalog.");
      const menuId = firstMenu.id;

      const orderPayload = {
        tableId,
        items: [{ menuId, quantity: 2 }],
        notes: "Checkout from Next.js visual dashboard",
      };

      log(`[${activeBranch.toUpperCase()}] Executing otonom checkout: Table ${config.tableNum}...`);
      const checkoutRes = await fetch(`${url}/db/local/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      const checkoutData = await checkoutRes.json();

      if (checkoutRes.ok && checkoutData.order) {
        const ord = checkoutData.order;
        log(`[${activeBranch.toUpperCase()}] Checkout SUCCESS! Order #${ord.orderNumber}, Total: Rp${Number(ord.grandTotal).toLocaleString()}`, "success");
        
        // Auto init payment entry
        await fetch(`${url}/db/local/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: ord.id }),
        });

        void fetchBranchData(activeBranch);
      } else {
        log(`Checkout Failed: ${checkoutData.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to simulate checkout: ${err.message}`, "error");
    }
  };

  // Payment QRIS webhook simulation
  const simulatePayment = async (orderId: string, grandTotal: number) => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Requesting secure payment verification for Order ID: ${orderId}...`);
    try {
      const res = await fetch(`${url}/db/local/payments/simulate-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Webhook confirm: Order PAID. Replicated transactions log generated!`, "success");
        void fetchBranchData(activeBranch);
      } else {
        log(`Payment simulation error: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Payment verification failed: ${err.message}`, "error");
    }
  };

  // Outage simulation
  const toggleDatabaseOutage = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Toggling network database connection outage status...`, "warning");
    try {
      const res = await fetch(`${url}/db/local/simulate-db-outage`, { method: "POST" });
      const data = await res.json();
      log(`[${activeBranch.toUpperCase()}] Database simulated offline status is now: ${data.isOffline}`, "warning");
      void fetchBranchData(activeBranch);
    } catch (err: any) {
      log(`Failed to toggle outage status: ${err.message}`, "error");
    }
  };

  // BullMQ sync report
  const triggerDailySync = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;
    const todayStr = new Date().toISOString().split("T")[0];

    log(`[${activeBranch.toUpperCase()}] Triggering BullMQ daily report aggregate sync for date: ${todayStr}...`);
    try {
      const res = await fetch(`${url}/db/local/trigger-daily-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate: todayStr }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] BullMQ job created! Job ID: ${data.jobId}. Aggregating transactions...`, "success");
        setTimeout(() => {
          void fetchReplication();
        }, 2000);
      } else {
        log(`Daily sync trigger failed: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to trigger daily report sync: ${err.message}`, "error");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">☕</span>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent font-sans">
              LC-DOS Next.js Dashboard
            </h1>
          </div>
          <p className="text-slate-400 mt-1 font-sans">Letter Coffee Distributed Ordering System — Pemrograman Data Terdistribusi</p>
        </div>
        <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-2 rounded-full text-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
          <span className="text-slate-300 font-semibold font-sans">Cluster Nodes: ACTIVE</span>
        </div>
      </header>

      {/* Grid 1: Replication SLA & Master Menu */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Replication Status */}
        <div className="bg-slate-950/60 backdrop-blur-md p-6 rounded-2xl border border-white/5 flex flex-col justify-between space-y-6">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-amber-400 font-sans">📡 Replication SLA Monitoring</h2>
              <button 
                onClick={() => fetchReplication(true)} 
                disabled={isRefreshingRep}
                className="text-xs text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded transition disabled:opacity-50 font-sans"
              >
                {isRefreshingRep ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4 font-sans">Memonitor lag PostgreSQL logical replication dari db-pusat ke masing-masing cabang.</p>
            <div className="space-y-4">
              {replicationSlots.length > 0 ? (
                replicationSlots.map((slot) => {
                  const isSlaVioted = slot.currentLagSeconds > slot.slaLimitSeconds;
                  return (
                    <div key={slot.slotName} className="border border-slate-800/80 bg-slate-900/40 p-4 rounded-xl flex items-center justify-between font-sans">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm uppercase text-slate-200">{slot.branchSlug}</span>
                          <span className={`text-[10px] px-2 py-0.5 border rounded-full font-mono ${
                            slot.active ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                          }`}>
                            {slot.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">Slot: {slot.slotName}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-300">
                          Lag: <span className={isSlaVioted ? "text-red-400 font-bold" : "text-emerald-400"}>{slot.currentLagSeconds}s</span>
                        </div>
                        <div className="text-[10px] text-slate-500">SLA: {slot.slaLimitSeconds}s</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-500 text-sm py-4 text-center font-sans">Loading replication slots data...</div>
              )}
            </div>
          </div>
          <div className="text-xs bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-slate-400 font-light font-sans">
            <span className="font-semibold text-amber-500">SLA Policy:</span> Tasikmalaya Max 3s lag, Surabaya & Malang Max 5s lag. Alert dipicu jika delay melebihi SLA &gt; 120s secara beruntun.
          </div>
        </div>

        {/* Master Catalog */}
        <div className="bg-slate-950/60 backdrop-blur-md p-6 rounded-2xl border border-white/5 lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-amber-400 font-sans">📂 Central Master Catalog (db-pusat)</h2>
            <button 
              onClick={() => fetchMasterMenus(true)} 
              disabled={isRefreshingMenu}
              className="text-xs text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded transition disabled:opacity-50 font-sans"
            >
              {isRefreshingMenu ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="text-xs text-slate-400 font-sans">Perubahan harga dasar di sini otomatis direplikasi oleh PostgreSQL logis ke semua cabang.</p>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3">SKU</th>
                  <th className="py-3">Name</th>
                  <th className="py-3">Category</th>
                  <th className="py-3">Base Price</th>
                  <th className="py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-sm">
                {masterMenus.length > 0 ? (
                  masterMenus.map((menu) => (
                    <tr key={menu.id} className="border-b border-slate-800/30 hover:bg-slate-900/10 transition">
                      <td className="py-3 font-mono text-amber-500 font-medium">{menu.sku}</td>
                      <td className="py-3 font-medium text-slate-200">{menu.name}</td>
                      <td className="py-3 text-slate-400 text-xs">{menu.category?.name || "N/A"}</td>
                      <td className="py-3 font-bold text-slate-300">Rp{Number(menu.priceMaster?.basePrice || 0).toLocaleString()}</td>
                      <td className="py-3 text-right">
                        <button 
                          onClick={() => handleEditMasterPrice(menu.id, menu.name, menu.priceMaster?.basePrice || 0)}
                          className="text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-amber-400 px-3 py-1.5 rounded-lg border border-slate-700/60 transition font-sans"
                        >
                          Edit Price
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-500 font-sans">Loading master menus...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Grid 2: Branch Operations Simulator */}
      <div className="bg-slate-950/60 backdrop-blur-md p-6 md:p-8 rounded-3xl border border-white/5 space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-orange-400 font-sans">⚙️ Branch Operations Simulator</h2>
            <p className="text-slate-400 text-sm mt-1 font-light font-sans">Simulasikan transaksi mandiri, override harga lokal, caching Redis, dan BullMQ harian per cabang.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["tasikmalaya", "surabaya", "malang"].map((slug) => (
              <button
                key={slug}
                onClick={() => setActiveBranch(slug)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-300 font-sans ${
                  activeBranch === slug
                    ? "border-orange-500 bg-orange-500/10 text-orange-400 shadow shadow-orange-500/20"
                    : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                {slug.toUpperCase()} (Port {CONFIGS[slug]?.port || ""})
              </button>
            ))}
          </div>
        </div>

        {activeBranch ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Column 1: Local Catalog */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-300 text-base font-sans">🛍️ Local Catalog</h3>
                <span className="text-xs bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded font-mono">
                  {isDbOffline ? "REDIS CACHE ACTIVE" : "LIVE DB"}
                </span>
              </div>
              <div className="space-y-3 font-sans">
                {branchMenus.map((menu) => {
                  const basePrice = Number(menu.priceMaster?.basePrice || 0);
                  const matchedOverride = menu.priceOverrides?.find(o => o.branchId !== ""); // simplified match logic
                  const overrideVal = matchedOverride ? Number(matchedOverride.overridePrice) : null;
                  const hasOverride = overrideVal !== null;
                  const effectivePrice = hasOverride ? overrideVal : basePrice;

                  return (
                    <div key={menu.id} className="border border-slate-800/80 bg-slate-900/20 p-4 rounded-xl space-y-3 flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-bold text-sm text-slate-200">{menu.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">SKU: {menu.sku}</div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold text-sm ${hasOverride ? "text-amber-400" : "text-slate-200"}`}>
                            Rp{effectivePrice.toLocaleString()}
                          </div>
                          {hasOverride && (
                            <div className="text-[10px] text-slate-500 line-through">Rp{basePrice.toLocaleString()}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        {hasOverride && (
                          <button 
                            onClick={() => removePriceOverride(menu.id, menu.name)} 
                            className="text-[10px] bg-red-950/20 border border-red-900/40 hover:bg-red-900/30 text-red-400 px-2 py-1 rounded transition"
                          >
                            Remove Override
                          </button>
                        )}
                        <button 
                          onClick={() => openOverrideModal(menu)} 
                          className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded transition"
                        >
                          Set Local Override
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Operations & Simulations */}
            <div className="space-y-4">
              <h3 className="font-bold text-slate-300 text-base font-sans">🛒 Simulation & Operations</h3>
              
              <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-xl space-y-4 font-sans">
                <div className="text-xs uppercase text-slate-400 font-semibold border-b border-slate-800/50 pb-2">Status Node Cabang</div>
                <div className="flex justify-between items-center text-sm">
                  <span>Database Status:</span>
                  <span className={`text-xs px-2 py-0.5 border rounded ${
                    isDbOffline ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  }`}>
                    {isDbOffline ? "OFFLINE / DISCONNECTED" : "ONLINE"}
                  </span>
                </div>
                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={simulateCheckout} 
                    className="flex-1 text-xs bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold px-3 py-2.5 rounded-lg transition"
                  >
                    ⚡ Simulasikan Checkout (Table {activeBranch ? CONFIGS[activeBranch]?.tableNum : ""})
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={triggerDailySync} 
                    className="flex-1 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 px-3 py-2.5 rounded-lg transition"
                  >
                    📅 Sync Laporan Harian (BullMQ)
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-xl space-y-3 font-sans">
                <div className="text-xs uppercase text-slate-400 font-semibold border-b border-slate-800/50 pb-2">Demonstrasi Teorema CAP</div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-light">Simulasikan putusnya jaringan cabang ke Pusat atau database padam. Cache Redis lokal tetap melayani pembacaan menu pelanggan.</p>
                
                <div className="flex gap-2 pt-1">
                  <button 
                    onClick={toggleDatabaseOutage} 
                    className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-lg transition border ${
                      isDbOffline 
                        ? "bg-emerald-950/20 border-emerald-900 text-emerald-400 hover:bg-emerald-900/30" 
                        : "bg-red-950/20 border-red-900 text-red-400 hover:bg-red-900/30"
                    }`}
                  >
                    {isDbOffline ? "🔥 Aktifkan Kembali Database" : "💥 Matikan Database / Simulasi Offline"}
                  </button>
                </div>
              </div>
            </div>

            {/* Column 3: Recent Orders */}
            <div className="space-y-4">
              <h3 className="font-bold text-slate-300 text-base font-sans">📝 Recent Orders (db-{activeBranch})</h3>
              <div className="space-y-3 font-sans">
                {branchOrders.length > 0 ? (
                  branchOrders.map((order) => {
                    const isPending = order.status === "PENDING";
                    const itemsText = order.items.map(item => `${item.quantity}x ${item.menu?.name || "Item"}`).join(", ");
                    return (
                      <div key={order.id} className="border border-slate-800 bg-slate-900/20 p-4 rounded-xl space-y-3 text-xs">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-slate-200">{order.orderNumber}</div>
                            <div className="text-[10px] text-slate-500 font-light">{new Date(order.createdAt).toLocaleString()}</div>
                          </div>
                          <span className={`px-2 py-0.5 border rounded-full font-semibold ${
                            isPending ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                          }`}>{order.status}</span>
                        </div>
                        <div className="text-slate-300 font-light leading-relaxed">
                          <span className="font-semibold text-slate-400">Items:</span> {itemsText}
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-800/40 pt-2 text-slate-400">
                          <div>Total: <span className="font-bold text-slate-200">Rp{Number(order.grandTotal).toLocaleString()}</span></div>
                          {isPending && (
                            <button 
                              onClick={() => simulatePayment(order.id, Number(order.grandTotal))} 
                              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3 py-1 rounded font-bold transition"
                            >
                              💸 Lunas (QRIS)
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-slate-500 text-xs py-4 text-center font-light">Belum ada pesanan terbaru di cabang ini.</div>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="text-slate-500 text-center py-12 border border-dashed border-slate-800 rounded-2xl font-sans">
            Silakan pilih salah satu cabang di atas untuk memfokuskan visual simulator.
          </div>
        )}
      </div>

      {/* Logs Console */}
      <div className="bg-slate-950/60 backdrop-blur-md p-6 rounded-2xl border border-white/5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-bold text-slate-300 font-sans">📝 Operations Audit Log Console</h3>
          <button 
            onClick={clearLogs} 
            className="text-xs text-slate-500 hover:text-slate-300 bg-slate-900 border border-slate-850 px-2 py-1 rounded transition font-sans"
          >
            Clear
          </button>
        </div>
        <div 
          ref={consoleRef}
          className="bg-black/80 p-4 rounded-xl font-mono text-xs text-emerald-400 min-h-[160px] max-h-[300px] overflow-y-auto space-y-1.5 scrollbar-thin border border-slate-900"
        >
          {logs.map((logItem) => {
            let color = "text-emerald-400";
            if (logItem.type === "error") color = "text-red-400";
            if (logItem.type === "warning") color = "text-amber-400";
            if (logItem.type === "success") color = "text-emerald-300 font-semibold";
            return (
              <div key={logItem.id} className={color}>
                [{logItem.time}] [{logItem.type.toUpperCase()}] {logItem.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* Override Modal */}
      {modalOpen && modalMenu && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-center items-center p-4 z-50">
          <div className="bg-slate-950 p-6 rounded-2xl max-w-md w-full border border-white/10 space-y-6 font-sans">
            <h3 className="text-lg font-bold text-amber-400">✏️ Set Local Price Override</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">Menu Item</label>
                <input 
                  type="text" 
                  value={modalMenu.name} 
                  className="w-full bg-slate-900 border border-slate-850 px-3 py-2 rounded-lg text-slate-400 outline-none" 
                  readOnly 
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">Current Base Price</label>
                <input 
                  type="text" 
                  value={`Rp${Number(modalMenu.priceMaster?.basePrice || 0).toLocaleString()}`} 
                  className="w-full bg-slate-900 border border-slate-850 px-3 py-2 rounded-lg text-slate-400 outline-none" 
                  readOnly 
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">Local Override Price (Rp)</label>
                <input 
                  type="number" 
                  value={overridePriceInput} 
                  onChange={(e) => setOverridePriceInput(Number((e.target as HTMLInputElement).value))}
                  className="w-full bg-black border border-slate-800 focus:border-amber-500 px-3 py-2 rounded-lg text-slate-100 outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">Override Reason</label>
                <input 
                  type="text" 
                  value={overrideReasonInput}
                  onChange={(e) => setOverrideReasonInput((e.target as HTMLInputElement).value)}
                  placeholder="Biaya operasional lokal tinggi" 
                  className="w-full bg-black border border-slate-800 focus:border-amber-500 px-3 py-2 rounded-lg text-slate-100 outline-none" 
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setModalOpen(false)} 
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold transition"
              >
                Batal
              </button>
              <button 
                onClick={submitPriceOverride} 
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-xl text-sm font-semibold text-slate-950 transition"
              >
                Simpan Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
