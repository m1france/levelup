/* Chargé par le service worker généré (workbox importScripts). */
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: 'LevelUp', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'LevelUp', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: d,
      actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {};
  event.notification.close();
  // Réponse en un geste depuis la notification, sans ouvrir l'app.
  if (event.action && d.answerToken) {
    event.waitUntil(
      fetch(`/api/public/answer/${d.answerToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: event.action }),
      })
        .then((r) => r.json())
        .then((v) =>
          self.registration.showNotification(event.action === 'yes' ? '👍 Réponse envoyée : présent' : 'Réponse envoyée : absent', {
            body: `${v.child?.firstName ?? ''} · ${v.title ?? ''}. Merci !`,
            icon: '/icon-192.png',
            tag: d.tag,
            data: { url: d.url },
          }),
        )
        .catch(() => self.clients.openWindow(`/r/${d.answerToken}`)),
    );
    return;
  }
  const url = d.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
