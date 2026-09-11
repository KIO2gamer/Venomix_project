export type FieldReportPayload = {
  reporter: string;
  category: "road" | "vehicle" | "delivery" | "safety" | "other";
  description: string;
  location?: [number, number];
};

export type QueuedItem = {
  clientId: string;
  report: FieldReportPayload;
  timestamp: number;
};

const STORAGE_KEY = "ner_pending_reports";

export function enqueueOfflineReport(report: FieldReportPayload): QueuedItem {
  const queued: QueuedItem[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const newItem: QueuedItem = {
    clientId: `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    report,
    timestamp: Date.now(),
  };
  queued.push(newItem);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queued));
  return newItem;
}

export async function syncPendingReportsToServer(): Promise<number> {
  const queued: QueuedItem[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (!queued.length) return 0;

  try {
    const payload = {
      items: queued.map((item) => ({
        client_id: item.clientId,
        report: item.report,
      })),
    };

    const response = await fetch("/api/sync/offline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.accepted > 0) {
      // Remove successfully synced items
      localStorage.removeItem(STORAGE_KEY);
    }
    return data.accepted;
  } catch (error) {
    console.warn("Offline sync pending - network unavailable:", error);
    return 0;
  }
}

// Auto-sync listener on reconnection
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void syncPendingReportsToServer();
  });
}