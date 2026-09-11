// Offline-first notification helpers.
//
// The app can raise alerts in two ways:
//   1. Server Web Push, delivered by the backend (needs connectivity).
//   2. On-device local notifications handled by the service worker (works
//      with no network at all).
//
// Everything here degrades gracefully: if the service worker is unavailable we
// fall back to the Notification API directly, and if permission is missing we
// queue the alert for later instead of dropping it.

export type LocalAlert = { title: string; body: string; area?: string };

const QUEUE_CACHE = "ner-alert-queue";
const QUEUE_URL = "/queued-alerts";
const QUEUE_KEY = "ner-alert-queue";

function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

export async function ensurePermission(): Promise<boolean> {
  if (!isSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/** Register the service worker, reused by both online and offline paths. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    await navigator.serviceWorker.register("/sw.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function toQueueEntry(alert: LocalAlert): LocalAlert & { queuedAt: number } {
  return { ...alert, queuedAt: Date.now() };
}

function readLocalQueue(): (LocalAlert & { queuedAt: number })[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalQueue(queue: (LocalAlert & { queuedAt: number })[]): void {
  try {
    if (queue.length) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } else {
      localStorage.removeItem(QUEUE_KEY);
    }
  } catch {
    // localStorage can be unavailable (private mode); the Cache queue still works.
  }
}

/**
 * Show an alert on this device without contacting any server.
 * Returns true when the notification was actually presented.
 */
export async function showLocalAlert(alert: LocalAlert): Promise<boolean> {
  const granted = await ensurePermission();
  if (!granted) {
    void queueAlert(alert);
    return false;
  }

  const registration = await registerServiceWorker();
  if (registration) {
    try {
      await registration.showNotification(`⚠️ ${alert.title}`, {
        body: alert.area ? `[WARNING] ${alert.area}: ${alert.body}` : alert.body,
        tag: "ner-logistics-emergency",
        renotify: true,
        requireInteraction: true, // Keeps the notification visible until the user interacts with it
        vibrate: [300, 100, 300, 100, 300], // Warning vibration pattern for mobile devices
        icon: "/icons/warning-icon.png", // Optional: customized alert icon
        badge: "/icons/badge-icon.png",  // Optional: small monocrome badge for mobile status bars
        data: { url: "/" },
      } as NotificationOptions & { renotify?: boolean; requireInteraction?: boolean; vibrate?: number[] });
      return true;
    } catch {
      // fall through to the direct Notification API
    }
  }

  // Fallback for non-service worker context
  try {
    new Notification(`⚠️ ${alert.title}`, {
      body: alert.area ? `[WARNING] ${alert.area}: ${alert.body}` : alert.body,
      tag: "ner-logistics-emergency",
      requireInteraction: true,
    } as NotificationOptions & { requireInteraction?: boolean });
    return true;
  } catch {
    void queueAlert(alert);
    return false;
  }
}

/**
 * Persist an alert so it can be shown once connectivity (or permission)
 * becomes available again.
 */
export async function queueAlert(alert: LocalAlert): Promise<void> {
  const entry = toQueueEntry(alert);

  const local = readLocalQueue();
  if (!local.some((item) => item.body === entry.body && item.queuedAt === entry.queuedAt)) {
    local.push(entry);
    writeLocalQueue(local);
  }

  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(QUEUE_CACHE);
      const stored = await cache.match(QUEUE_URL);
      const existing = stored ? await stored.json() : [];
      existing.push(entry);
      await cache.put(
        QUEUE_URL,
        new Response(JSON.stringify(existing), { headers: { "Content-Type": "application/json" } })
      );
    }
  } catch {
    // Cache API may be unavailable offline-first in some contexts; ignore.
  }

  // Ask the service worker to deliver as soon as it regains connectivity.
  notifyServiceWorker({ type: "flush-queue" });
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(
        "ner-alert-queue"
      );
    } catch {
      // Background Sync unsupported; the alert stays queued locally.
    }
  }
}

/** Deliver every queued alert that has not been shown yet. */
export async function flushQueuedAlerts(): Promise<number> {
  const granted = await ensurePermission();
  if (!granted) return 0;

  const queue = readLocalQueue();
  if (!queue.length) return 0;

  const remaining: typeof queue = [];
  for (const alert of queue) {
    const shown = await showLocalAlert(alert).catch(() => false);
    if (!shown) remaining.push(alert);
  }
  writeLocalQueue(remaining);
  return queue.length - remaining.length;
}

export function notifyServiceWorker(message: unknown): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const send = (worker: ServiceWorker | null) => worker?.postMessage(message);
  if (navigator.serviceWorker.controller) {
    send(navigator.serviceWorker.controller);
  } else {
    void navigator.serviceWorker.ready.then((reg) => send(reg.active));
  }
}
