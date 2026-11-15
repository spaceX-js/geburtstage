// Service Worker: zeigt Erinnerungen an und öffnet beim Antippen die App (bei Geburtstagen direkt die Person).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { m = { title: "Geburtstage", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(m.title || "Geburtstage", {
    body: m.body || "",
    tag: m.tag || "geburtstage",
    renotify: true,
    icon: "/icon.png",
    badge: "/icon.png",
    data: { url: m.url || "/" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { try { await w.navigate(url); } catch (e) {} return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
