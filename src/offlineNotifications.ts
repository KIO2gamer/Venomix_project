export async function showLocalWarningAlert(alert: { title: string; body: string; area?: string }): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    if (registration) {
      try {
        await registration.showNotification(`⚠️ ${alert.title}`, {
          body: alert.area ? `[WARNING] ${alert.area}: ${alert.body}` : alert.body,
          tag: "ner-logistics-emergency",
          renotify: true,
          requireInteraction: true,
          vibrate: [300, 100, 300, 100, 300],
          data: { url: "/" },
        } as NotificationOptions & { renotify?: boolean; requireInteraction?: boolean; vibrate?: number[] });
        return true;
      } catch {
        // Fall back to DOM notification
      }
    }
  }

  // Fallback direct notification
  new Notification(`⚠️ ${alert.title}`, {
    body: alert.area ? `[WARNING] ${alert.area}: ${alert.body}` : alert.body,
    tag: "ner-logistics-emergency",
  });
  return true;
}