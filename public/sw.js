// Cache the app shell so the interface (and its notification handlers) keep
// working when the device has no connectivity.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("ner-static-v2").then((cache) => {
      // Keep this list to URLs that exist in both Vite development and the
      // production bundle. A failed addAll() aborts service-worker install.
      return cache.addAll(["/", "/index.html"]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Serve the cached app shell when the network is unavailable.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }
  // Never serve stale API responses; navigation and shell assets only.
  if (request.url.includes("/api/")) {
    return;
  }
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || caches.match("/index.html")).then((cached) => cached || Response.error())
    )
  );
});

function normalizePayload(data) {
  const fallback = { title: "NER Logistics alert", body: "A new emergency alert is available.", area: "" };
  if (!data) {
    return fallback;
  }
  if (typeof data === "string") {
    return { ...fallback, body: data };
  }
  return { ...fallback, ...data };
}

function showAlertNotification(raw) {
  const data = normalizePayload(raw);
  const title = data.title || "NER Logistics alert";
  const body = data.area ? `${data.area}: ${data.body}` : data.body;
  return self.registration.showNotification(title, {
    body,
    tag: "ner-logistics-emergency",
    renotify: true,
    data: { url: "/" },
  });
}

// Server Web Push (requires connectivity).
self.addEventListener("push", (event) => {
  const fallback = { title: "NER Logistics alert", body: "A new emergency alert is available.", area: "" };
  let data = fallback;

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { ...fallback, body: event.data.text() || fallback.body };
    }
  }

  event.waitUntil(showAlertNotification(data));
});

// On-device local alerts (no network required). The page posts an alert here
// whenever the backend cannot be reached, so alerts still fire offline.
self.addEventListener("message", (event) => {
  const payload = event.data || {};
  if (payload.type === "local-alert") {
    event.waitUntil(showAlertNotification(payload.alert));
  }
  if (payload.type === "flush-queue") {
    event.waitUntil(flushQueuedAlerts());
  }
});

// Background Sync: deliver anything queued while offline as soon as the
// network returns.
self.addEventListener("sync", (event) => {
  if (event.tag === "ner-alert-queue") {
    event.waitUntil(flushQueuedAlerts());
  }
});

async function flushQueuedAlerts() {
  let queue = [];
  try {
    const cache = await caches.open("ner-alert-queue");
    const stored = await cache.match("/queued-alerts");
    if (stored) {
      queue = await stored.json();
    }
  } catch {
    queue = [];
  }

  const remaining = [];
  for (const alert of queue) {
    try {
      await showAlertNotification(alert);
    } catch {
      remaining.push(alert);
    }
  }

  const cache = await caches.open("ner-alert-queue");
  if (remaining.length) {
    await cache.put("/queued-alerts", new Response(JSON.stringify(remaining), { headers: { "Content-Type": "application/json" }}));
  } else {
    await cache.delete("/queued-alerts");
  }
  return remaining.length;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
