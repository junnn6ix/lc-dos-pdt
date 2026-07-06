"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Coffee, 
  Activity, 
  Database, 
  RefreshCw, 
  Terminal, 
  Trash2, 
  Plus, 
  Check, 
  AlertTriangle, 
  CheckCircle2, 
  Wallet, 
  Server, 
  Clock, 
  Settings, 
  Layers, 
  Wifi, 
  WifiOff,
  Coins,
  FileSpreadsheet,
  Network
} from "lucide-react";

// Types definition
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

const CONFIGS: Record<string, { port: number; label: string; tableNum: string; color: string }> = {
  tasikmalaya: { port: 3002, label: "Tasikmalaya (HQ & Local)", tableNum: "T-01", color: "from-blue-500 to-indigo-600" },
  surabaya: { port: 3003, label: "Surabaya (Remote Branch)", tableNum: "S-01", color: "from-purple-500 to-pink-600" },
  malang: { port: 3004, label: "Malang (Onboarded Branch)", tableNum: "M-01", color: "from-emerald-500 to-teal-600" },
};

// Custom Shadcn Component Emulations
const Card = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm text-zinc-50 shadow-sm transition-all duration-300 hover:border-zinc-700/80 ${className}`} {...props}>
    {children}
  </div>
);

const CardHeader = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props}>
    {children}
  </div>
);

const CardTitle = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`text-base font-semibold leading-none tracking-tight text-zinc-100 ${className}`} {...props}>
    {children}
  </h3>
);

const CardDescription = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={`text-xs text-zinc-400 font-light ${className}`} {...props}>
    {children}
  </p>
);

const CardContent = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`p-6 pt-0 ${className}`} {...props}>
    {children}
  </div>
);

const Badge = ({ 
  className = "", 
  variant = "default", 
  children, 
  ...props 
}: React.HTMLAttributes<HTMLSpanElement> & { 
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" 
}) => {
  const variantStyles = {
    default: "bg-zinc-50 text-zinc-950 hover:bg-zinc-50/80",
    secondary: "bg-zinc-800 text-zinc-100 border border-zinc-700/50",
    destructive: "bg-red-500/10 text-red-400 border border-red-500/20",
    outline: "text-zinc-400 border border-zinc-800",
    success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${variantStyles[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"hq" | "branches">("hq");
  const [replicationSlots, setReplicationSlots] = useState<ReplicationSlot[]>([]);
  const [masterMenus, setMasterMenus] = useState<Menu[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>("tasikmalaya");
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

  // Log function
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

  // Auto-scroll console
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
      if (!res.ok) throw new Error("Central replication health check status returned an error.");
      const data = await res.json();
      setReplicationSlots(data.replicationSlots || []);
      if (showLog) log("Successfully synchronized replication status with db-pusat.", "success");
    } catch (err: any) {
      if (showLog) log(`Failed to fetch replication status: ${err.message}`, "error");
    } finally {
      if (showLog) setIsRefreshingRep(false);
    }
  };

  const fetchMasterMenus = async (showLog = false) => {
    if (showLog) setIsRefreshingMenu(true);
    try {
      const res = await fetch("http://localhost:3001/db/global/menus");
      if (!res.ok) throw new Error("Central catalog returned an error code.");
      const data = await res.json();
      setMasterMenus(data.menus || []);
      if (showLog) log("Central master menu catalog updated.", "success");
    } catch (err: any) {
      if (showLog) log(`Failed to fetch master catalog: ${err.message}`, "error");
    } finally {
      if (showLog) setIsRefreshingMenu(false);
    }
  };

  // Initialize and Poll
  useEffect(() => {
    log("LC-DOS Distributed Cluster Dashboard initialized.");
    void fetchReplication(true);
    void fetchMasterMenus(true);

    const interval = setInterval(() => {
      void fetchReplication(false);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Fetch branch specific details
  const fetchBranchData = async (branch: string) => {
    const config = CONFIGS[branch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    try {
      // Local db ping check
      let dbOnline = true;
      try {
        const pingRes = await fetch(`${url}/db/ping`);
        if (!pingRes.ok) dbOnline = false;
      } catch {
        dbOnline = false;
      }
      setIsDbOffline(!dbOnline);

      // Local catalog read
      const menusRes = await fetch(`${url}/db/global/menus`);
      const menusData = await menusRes.json();
      setBranchMenus(menusData.menus || []);

      if (menusData.source === "fallback_cache") {
        log(`[${branch.toUpperCase()}] Read catalog from local Redis fallback cache. Node database is offline!`, "warning");
      }

      // Local transactions read
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
      log(`[${branch.toUpperCase()}] Local node connection error: ${err.message}`, "error");
    }
  };

  useEffect(() => {
    if (activeBranch) {
      void fetchBranchData(activeBranch);
    }
  }, [activeBranch]);

  // Edit center base price
  const handleEditMasterPrice = async (menuId: string, name: string, currentPrice: number) => {
    const newPriceStr = prompt(`Update master base price for ${name} (Current: Rp ${currentPrice.toLocaleString()}):`, currentPrice.toString());
    if (newPriceStr === null) return;
    const newPrice = Number(newPriceStr);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert("Please enter a valid positive number.");
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
        log(`[Pusat] Successfully updated master catalog: ${name} base price changed to Rp${newPrice}. Replicating...`, "success");
        void fetchMasterMenus();
        if (activeBranch) {
          void fetchBranchData(activeBranch);
        }
      } else {
        log(`[Pusat] Master update rejected: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to apply master catalog changes: ${err.message}`, "error");
    }
  };

  // Override operations
  const openOverrideModal = (menu: Menu) => {
    setModalMenu(menu);
    const basePrice = menu.priceMaster?.basePrice || 0;
    setOverridePriceInput(basePrice + 2000);
    setOverrideReasonInput("Local logistic surcharge");
    setModalOpen(true);
  };

  const submitPriceOverride = async () => {
    if (!activeBranch || !modalMenu) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Requesting price override for ${modalMenu.name} (Price: Rp ${overridePriceInput})...`);
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
        log(`[${activeBranch.toUpperCase()}] Local price override configured.`, "success");
        setModalOpen(false);
        void fetchBranchData(activeBranch);
      } else {
        log(`[${activeBranch.toUpperCase()}] Local price override failed: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Override request failed: ${err.message}`, "error");
    }
  };

  const removePriceOverride = async (menuId: string, name: string) => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Deleting local price override for ${name}...`);
    try {
      const res = await fetch(`${url}/db/local/menu-price-overrides`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuId }),
      });
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Local override cleared. Fallback to center master price.`, "success");
        void fetchBranchData(activeBranch);
      } else {
        log(`Failed to clear local override.`, "error");
      }
    } catch (err: any) {
      log(`Override removal request failed: ${err.message}`, "error");
    }
  };

  // Simulated branch checkout
  const simulateCheckout = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Initializing local checkout checkout...`);
    try {
      const tablesRes = await fetch(`${url}/db/local/tables`);
      const tablesData = await tablesRes.json();
      const tables = tablesData.tables || [];
      if (tables.length === 0) throw new Error("Local dining tables registry returned empty.");
      const tableId = tables[0].id;

      const firstMenu = branchMenus[0];
      if (!firstMenu) throw new Error("Local menus catalog is empty.");
      const menuId = firstMenu.id;

      const orderPayload = {
        tableId,
        items: [{ menuId, quantity: 2 }],
        notes: "Checkout from Shadcn visual dashboard",
      };

      log(`[${activeBranch.toUpperCase()}] Creating local transaction order...`);
      const checkoutRes = await fetch(`${url}/db/local/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      const checkoutData = await checkoutRes.json();

      if (checkoutRes.ok && checkoutData.order) {
        const ord = checkoutData.order;
        log(`[${activeBranch.toUpperCase()}] Order #${ord.orderNumber} successfully registered (Subtotal: Rp ${Number(ord.subtotal).toLocaleString()}).`, "success");

        // Prepare local pending payment
        await fetch(`${url}/db/local/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: ord.id }),
        });

        void fetchBranchData(activeBranch);
      } else {
        log(`Local transaction registration failed: ${checkoutData.error}`, "error");
      }
    } catch (err: any) {
      log(`Checkout failed: ${err.message}`, "error");
    }
  };

  // Confirm payment via gateway simulation
  const simulatePayment = async (orderId: string, grandTotal: number) => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Triggering mock secure signature webhook callback...`);
    try {
      const res = await fetch(`${url}/db/local/payments/simulate-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Local payment confirmed via digital signature HMAC. Webhook processed.`, "success");
        void fetchBranchData(activeBranch);
      } else {
        log(`Payment simulation failed: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Gateway webhook callback failed: ${err.message}`, "error");
    }
  };

  // Simulated node outage
  const toggleDatabaseOutage = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;

    log(`[${activeBranch.toUpperCase()}] Triggering simulated local database outage...`, "warning");
    try {
      const res = await fetch(`${url}/db/local/simulate-db-outage`, { method: "POST" });
      const data = await res.json();
      log(`[${activeBranch.toUpperCase()}] Simulated offline status is now: ${data.isOffline ? "OFFLINE (Simulated)" : "ONLINE (Restored)"}`, "warning");
      void fetchBranchData(activeBranch);
    } catch (err: any) {
      log(`Failed to toggle simulated database status: ${err.message}`, "error");
    }
  };

  // BullMQ sync trigger
  const triggerDailySync = async () => {
    if (!activeBranch) return;
    const config = CONFIGS[activeBranch];
    if (!config) return;
    const url = `http://localhost:${config.port}`;
    const todayStr = new Date().toISOString().split("T")[0];

    log(`[${activeBranch.toUpperCase()}] Enqueuing daily aggregate synchronization background job in BullMQ (Date: ${todayStr})...`);
    try {
      const res = await fetch(`${url}/db/local/trigger-daily-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate: todayStr }),
      });
      const data = await res.json();
      if (res.ok) {
        log(`[${activeBranch.toUpperCase()}] Sync Job enqueued successfully. BullMQ Job ID: ${data.jobId}.`, "success");
        setTimeout(() => {
          void fetchReplication();
        }, 2000);
      } else {
        log(`Background job enqueuing failed: ${data.error}`, "error");
      }
    } catch (err: any) {
      log(`Failed to dispatch sync task: ${err.message}`, "error");
    }
  };

  // Dashboard Stats Calculations
  const hasActiveViolation = replicationSlots.some(
    (slot) => !slot.active || slot.currentLagSeconds > slot.slaLimitSeconds
  );
  const replicationHealth = replicationSlots.length === 0 
    ? "Unknown" 
    : hasActiveViolation 
      ? "Violation" 
      : "Healthy";

  const avgLag = replicationSlots.length === 0 
    ? 0 
    : replicationSlots.reduce((acc, s) => acc + s.currentLagSeconds, 0) / replicationSlots.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans antialiased p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Block */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-800 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Coffee className="h-6 w-6 text-amber-500" />
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-sans">
                LC-DOS Cluster Dashboard
              </h1>
            </div>
            <p className="text-xs text-zinc-400 font-light font-sans">
              Distributed Ordering System — Advanced Distributed Databases (HQ-Branch Logical Replication Layout)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void fetchReplication(true);
                void fetchMasterMenus(true);
                if (activeBranch) void fetchBranchData(activeBranch);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-850 text-xs text-zinc-300 hover:bg-zinc-800 transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync All Nodes
            </button>
            <Badge variant="success">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
              CLUSTER SYSTEM: ONLINE
            </Badge>
          </div>
        </header>

        {/* Stats Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-zinc-400">Total Cluster Nodes</CardTitle>
              <Server className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-zinc-50">4 Nodes</div>
              <p className="text-[10px] text-zinc-500 font-light mt-1">1 Pusat HQ + 3 Branch Instances</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-zinc-400">Replication Status</CardTitle>
              <Network className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold ${replicationHealth === "Healthy" ? "text-emerald-400" : "text-amber-500"}`}>
                {replicationHealth}
              </div>
              <p className="text-[10px] text-zinc-500 font-light mt-1">
                {hasActiveViolation ? "SLA thresholds exceeded!" : "All replication streams healthy"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-zinc-400">Average Stream Lag</CardTitle>
              <Clock className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-zinc-50">{avgLag.toFixed(2)}s</div>
              <p className="text-[10px] text-zinc-500 font-light mt-1">Real-time PostgreSQL WAL lag check</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-zinc-400">Master Catalog Size</CardTitle>
              <FileSpreadsheet className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-zinc-50">{masterMenus.length} Menu Items</div>
              <p className="text-[10px] text-zinc-500 font-light mt-1">Global catalog replicated row-level</p>
            </CardContent>
          </Card>
        </div>

        {/* Tab Controls */}
        <div className="border-b border-zinc-800">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab("hq")}
              className={`pb-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "hq" ? "border-amber-500 text-amber-500" : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Central HQ & SLA Replications
            </button>
            <button
              onClick={() => setActiveTab("branches")}
              className={`pb-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "branches" ? "border-amber-500 text-amber-500" : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Branch Nodes Operations Simulator
            </button>
          </div>
        </div>

        {/* Tab HQ Content */}
        {activeTab === "hq" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Replication Slots */}
            <div className="space-y-4 lg:col-span-1">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-zinc-100 font-sans">Logical Replication Slots</h2>
                <p className="text-[11px] text-zinc-400 leading-normal">
                  PostgreSQL replication streams from `db-pusat` to active subscribers.
                </p>
              </div>

              <div className="space-y-3">
                {replicationSlots.length > 0 ? (
                  replicationSlots.map((slot) => {
                    const isSlaViolated = slot.currentLagSeconds > slot.slaLimitSeconds;
                    const cnf = CONFIGS[slot.branchSlug] || { color: "from-zinc-500 to-zinc-600" };
                    return (
                      <Card key={slot.slotName} className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <div className={`h-2.5 w-2.5 rounded-full bg-gradient-to-tr ${cnf.color}`}></div>
                            <span className="font-bold text-xs uppercase text-zinc-200">{slot.branchSlug}</span>
                          </div>
                          <Badge variant={slot.active ? "success" : "destructive"}>
                            {slot.active ? "Streaming" : "Inactive"}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs border-t border-zinc-800/60 pt-2 font-mono">
                          <div>
                            <span className="text-zinc-500">Lag:</span>{" "}
                            <span className={isSlaViolated ? "text-red-400 font-bold" : "text-emerald-400"}>
                              {slot.currentLagSeconds}s
                            </span>
                          </div>
                          <div className="text-right text-zinc-400">
                            <span className="text-zinc-500">SLA:</span> {slot.slaLimitSeconds}s
                          </div>
                        </div>

                        <div className="text-[10px] text-zinc-500 border-t border-zinc-800/40 pt-1.5 font-mono">
                          Replication Slot: {slot.slotName}
                        </div>
                      </Card>
                    );
                  })
                ) : (
                  <Card className="p-6 text-center text-zinc-500 text-xs">
                    No active logical replication slots detected.
                  </Card>
                )}
              </div>
            </div>

            {/* Central Master Catalog */}
            <div className="space-y-4 lg:col-span-2">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-zinc-100 font-sans">Central Master Catalog (db-pusat)</h2>
                  <p className="text-[11px] text-zinc-400 leading-normal">
                    Database tables on `db-pusat` replicated down to branch nodes. Read-only at branches.
                  </p>
                </div>
                <button
                  onClick={() => fetchMasterMenus(true)}
                  disabled={isRefreshingMenu}
                  className="inline-flex items-center justify-center p-1.5 rounded-md border border-zinc-850 hover:bg-zinc-900 transition text-zinc-300 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingMenu ? "animate-spin" : ""}`} />
                </button>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-850 bg-zinc-900/10 text-zinc-400 font-semibold uppercase tracking-wider">
                        <th className="p-4">SKU</th>
                        <th className="p-4">Menu Name</th>
                        <th className="p-4">Category</th>
                        <th className="p-4">Central Price</th>
                        <th className="p-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-sm">
                      {masterMenus.length > 0 ? (
                        masterMenus.map((menu) => (
                          <tr key={menu.id} className="hover:bg-zinc-900/10 transition text-xs">
                            <td className="p-4 font-mono text-amber-500">{menu.sku}</td>
                            <td className="p-4 font-medium text-zinc-200">{menu.name}</td>
                            <td className="p-4 text-zinc-400">{menu.category?.name || "N/A"}</td>
                            <td className="p-4 font-bold text-zinc-300">Rp{Number(menu.priceMaster?.basePrice || 0).toLocaleString()}</td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => handleEditMasterPrice(menu.id, menu.name, menu.priceMaster?.basePrice || 0)}
                                className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-850 text-[10px] text-zinc-300 hover:text-amber-500 hover:bg-zinc-850 transition"
                              >
                                Edit Base
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-zinc-500">No catalog data enregistered.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

          </div>
        )}

        {/* Tab Branches Simulator Content */}
        {activeTab === "branches" && (
          <div className="space-y-6">
            
            {/* Branch Selection Pills */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-zinc-900/20 p-3 rounded-lg border border-zinc-850">
              <span className="text-xs font-semibold text-zinc-300">Select Active Branch Node:</span>
              <div className="flex gap-2">
                {Object.keys(CONFIGS).map((slug) => {
                  const isActive = activeBranch === slug;
                  return (
                    <button
                      key={slug}
                      onClick={() => setActiveBranch(slug)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase transition border ${
                        isActive
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                          : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {slug} (Port {CONFIGS[slug]?.port})
                    </button>
                  );
                })}
              </div>
            </div>

            {activeBranch ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Branch Local Catalog Catalog */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold text-zinc-100 font-sans">Local Catalog & Overrides</h3>
                      <Badge variant={isDbOffline ? "warning" : "success"}>
                        {isDbOffline ? "Redis Fallback Cache" : "Live DB Sync"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                      Local branch pricing list. Set overrides for specific branch markets.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {branchMenus.map((menu) => {
                      const basePrice = Number(menu.priceMaster?.basePrice || 0);
                      const matchedOverride = menu.priceOverrides?.find(o => o.branchId !== "");
                      const overrideVal = matchedOverride ? Number(matchedOverride.overridePrice) : null;
                      const hasOverride = overrideVal !== null;
                      const effectivePrice = hasOverride ? overrideVal : basePrice;

                      return (
                        <Card key={menu.id} className="p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-bold text-xs text-zinc-200">{menu.name}</div>
                              <div className="text-[9px] text-zinc-500 font-mono">SKU: {menu.sku}</div>
                            </div>
                            <div className="text-right">
                              <div className={`font-bold text-xs ${hasOverride ? "text-amber-400" : "text-zinc-200"}`}>
                                Rp {effectivePrice.toLocaleString()}
                              </div>
                              {hasOverride && (
                                <div className="text-[9px] text-zinc-500 line-through">Rp {basePrice.toLocaleString()}</div>
                              )}
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 border-t border-zinc-800/40 pt-2.5">
                            {hasOverride && (
                              <button
                                onClick={() => removePriceOverride(menu.id, menu.name)}
                                className="px-2 py-1 rounded bg-red-950/20 hover:bg-red-950/40 text-[9px] text-red-400 border border-red-900/30 transition"
                              >
                                Clear Override
                              </button>
                            )}
                            <button
                              onClick={() => openOverrideModal(menu)}
                              className="px-2 py-1 rounded bg-zinc-900 border border-zinc-850 hover:bg-zinc-850 text-[9px] text-zinc-300 transition"
                            >
                              Configure Override
                            </button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                {/* Branch Outage Simulation */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-zinc-100 font-sans">Simulations Console</h3>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                      Trigger simulated load, system crashes, or asynchronous batch syncs.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <Card className="p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Node Connectivity</h4>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400">Database Status:</span>
                        <Badge variant={isDbOffline ? "destructive" : "success"}>
                          {isDbOffline ? "OFFLINE" : "ONLINE"}
                        </Badge>
                      </div>
                      <button
                        onClick={toggleDatabaseOutage}
                        className={`w-full text-xs font-semibold py-2 rounded-md border transition ${
                          isDbOffline
                            ? "bg-emerald-950/20 border-emerald-900 text-emerald-400 hover:bg-emerald-900/30"
                            : "bg-red-950/20 border-red-900 text-red-400 hover:bg-red-900/30"
                        }`}
                      >
                        {isDbOffline ? "🔌 Restore Database Status" : "💥 Simulate Outage (Disconnect)"}
                      </button>
                    </Card>

                    <Card className="p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Client Transactions</h4>
                      <p className="text-[10px] text-zinc-500 font-light leading-normal">
                        Simulate branch local checkout transactions on Table {CONFIGS[activeBranch]?.tableNum}.
                      </p>
                      <button
                        onClick={simulateCheckout}
                        className="w-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-zinc-950 py-2.5 rounded-md transition"
                      >
                        ⚡ Simulate Local Checkout
                      </button>
                    </Card>

                    <Card className="p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Daily Aggregate Job</h4>
                      <p className="text-[10px] text-zinc-500 font-light leading-normal">
                        Batch sync branch sales reports to db-pusat via BullMQ + Redis queue.
                      </p>
                      <button
                        onClick={triggerDailySync}
                        className="w-full text-xs font-semibold bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 py-2 rounded-md transition"
                      >
                        📅 Enqueue BullMQ Sync Job
                      </button>
                    </Card>
                  </div>
                </div>

                {/* Branch Local Orders */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-zinc-100 font-sans">Recent Local Orders</h3>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                      Latest transaction logs stored directly inside `db-{activeBranch}`.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {branchOrders.length > 0 ? (
                      branchOrders.map((order) => {
                        const isPending = order.status === "PENDING";
                        const itemsText = order.items.map(item => `${item.quantity}x ${item.menu?.name || "Item"}`).join(", ");
                        return (
                          <Card key={order.id} className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="font-bold text-xs text-zinc-200">{order.orderNumber}</span>
                                <div className="text-[9px] text-zinc-500 font-light font-mono">{new Date(order.createdAt).toLocaleString()}</div>
                              </div>
                              <Badge variant={isPending ? "warning" : "success"}>
                                {order.status}
                              </Badge>
                            </div>

                            <p className="text-xs text-zinc-300 font-light leading-relaxed">
                              <span className="font-semibold text-zinc-500">Order:</span> {itemsText}
                            </p>

                            <div className="flex justify-between items-center border-t border-zinc-800/40 pt-2.5 text-xs">
                              <div>Total: <span className="font-bold text-zinc-200">Rp {Number(order.grandTotal).toLocaleString()}</span></div>
                              {isPending && (
                                <button
                                  onClick={() => simulatePayment(order.id, Number(order.grandTotal))}
                                  className="bg-emerald-500 hover:bg-emerald-600 text-zinc-950 px-2 py-1 rounded text-[10px] font-bold transition flex items-center gap-1"
                                >
                                  <Coins className="h-3 w-3" />
                                  Confirm QRIS
                                </button>
                              )}
                            </div>
                          </Card>
                        );
                      })
                    ) : (
                      <Card className="p-6 text-center text-zinc-500 text-xs">
                        No transactions registered at this branch.
                      </Card>
                    )}
                  </div>
                </div>

              </div>
            ) : (
              <Card className="p-8 text-center text-zinc-500">
                Please select a branch node to begin simulation.
              </Card>
            )}

          </div>
        )}

        {/* Logs Terminal Block */}
        <section className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-bold text-zinc-100 font-sans">Audit Logs Terminal</h3>
            </div>
            <button
              onClick={clearLogs}
              className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-300 border border-zinc-850 px-2 py-1 rounded bg-zinc-900/40 hover:bg-zinc-850 transition"
            >
              Clear Logs
            </button>
          </div>
          
          <div className="rounded-xl border border-zinc-800 bg-black overflow-hidden shadow-2xl">
            {/* Terminal Window Header controls */}
            <div className="bg-zinc-900 border-b border-zinc-850 px-4 py-2 flex items-center justify-between">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/60 block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60 block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60 block"></span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">logs@lc-dos-cluster:~</span>
              <div className="w-10"></div>
            </div>
            
            <div
              ref={consoleRef}
              className="p-4 font-mono text-[11px] leading-relaxed text-emerald-400 min-h-[160px] max-h-[300px] overflow-y-auto space-y-1.5 scrollbar-thin bg-black/95"
            >
              {logs.map((logItem) => {
                let color = "text-emerald-400";
                if (logItem.type === "error") color = "text-red-400";
                if (logItem.type === "warning") color = "text-amber-400";
                if (logItem.type === "success") color = "text-emerald-300 font-semibold";
                return (
                  <div key={logItem.id} className={color}>
                    <span className="text-zinc-600">[{logItem.time}]</span>{" "}
                    <span className="opacity-80">[{logItem.type.toUpperCase()}]</span> {logItem.text}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

      </div>

      {/* Override Modal */}
      {modalOpen && modalMenu && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex justify-center items-center p-4 z-50 animate-in fade-in duration-200">
          <Card className="max-w-md w-full border border-zinc-800 bg-zinc-950 p-6 space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-amber-500">Configure Price Override</h3>
              <p className="text-xs text-zinc-400">Configure a local branch specific price for this menu catalog item.</p>
            </div>
            
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase font-semibold mb-1">Item SKU & Name</label>
                <input
                  type="text"
                  value={`[${modalMenu.sku}] ${modalMenu.name}`}
                  className="w-full bg-zinc-900 border border-zinc-850 px-3 py-2.5 rounded-lg text-zinc-400 outline-none"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase font-semibold mb-1">Current Base Price (HQ)</label>
                <input
                  type="text"
                  value={`Rp ${Number(modalMenu.priceMaster?.basePrice || 0).toLocaleString()}`}
                  className="w-full bg-zinc-900 border border-zinc-850 px-3 py-2.5 rounded-lg text-zinc-400 outline-none"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-semibold mb-1">Local Override Price (Rp)</label>
                <input
                  type="number"
                  value={overridePriceInput}
                  onChange={(e) => setOverridePriceInput(Number((e.target as HTMLInputElement).value))}
                  className="w-full bg-black border border-zinc-850 focus:border-amber-500 px-3 py-2.5 rounded-lg text-zinc-100 outline-none transition font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-semibold mb-1">Override Reason</label>
                <input
                  type="text"
                  value={overrideReasonInput}
                  onChange={(e) => setOverrideReasonInput((e.target as HTMLInputElement).value)}
                  placeholder="Local branch specific surcharges"
                  className="w-full bg-black border border-zinc-850 focus:border-amber-500 px-3 py-2.5 rounded-lg text-zinc-100 outline-none transition"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 rounded-lg text-xs font-semibold border border-zinc-850 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitPriceOverride}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg text-xs font-semibold text-zinc-950 transition"
              >
                Save Override
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
