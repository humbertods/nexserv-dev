// Nombre de caché diferenciado por entorno — evita que la limpieza de este
// SW borre caché de otro entorno si algún día comparten origen. "dev" queda
// en el nombre a propósito, nunca "prod".
const CACHE_NAME = 'nexserv-dev-v20260706';

// Base derivada de la propia ubicación del SW (nunca hardcodeada). Un
// Service Worker no tiene acceso a window/NEXSERV_BASE_PATH — self.location
// SÍ está disponible y siempre apunta a dónde este archivo realmente vive,
// así que la ruta base sale de ahí. Mismo archivo sirve para cualquier
// carpeta de publicación sin tocar código.
const NEX_BASE = self.location.pathname.replace(/sw\.js$/, '');

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Borrar cachés viejas de ESTE entorno únicamente. ESTRICTO:
  // nexserv-dev-* y distinta de la actual. Nunca nexserv-prod-*, ningún
  // otro nexserv-*, ni ninguna cache desconocida (incluida "firebase" —
  // ya no hace falta esa excepción porque el filtro positivo por prefijo
  // ya la deja intacta por no empezar con "nexserv-dev-").
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('nexserv-dev-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

self.addEventListener('push', e => {
  let data = { title: 'NexServ', body: 'Nueva actualización' };

  if (e.data) {
    try {
      data = e.data.json();
      const n = data.notification || data.data || {};
      data = {
        title: data.title || n.title || 'NexServ',
        body:  data.body  || n.body  || '',
        icon:  data.icon  || n.icon,
        tag:   data.tag   || n.tag,
        url:   (data.fcmOptions && data.fcmOptions.link) || (n.fcm_options && n.fcm_options.link) || data.url
      };
    } catch {
      const text = e.data.text();
      if (text) data = { title: 'NexServ', body: text };
    }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || (NEX_BASE + 'icon-192.png'),
    badge: data.badge || (NEX_BASE + 'icon-192.png'),
    tag: data.tag || 'nexserv-notif',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: data.url || NEX_BASE }
  };

  e.waitUntil(self.registration.showNotification(data.title || 'NexServ', options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || NEX_BASE;
  // Base absoluta REAL de este SW (nunca hardcodeada) — enfocar solo
  // clientes cuya URL empiece exactamente por esta base física. Un
  // substring como "nexserv" matchea tanto /nexserv/ como /nexserv-dev/;
  // esta comparación no.
  const NEX_BASE_ABS = self.location.origin + NEX_BASE;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.indexOf(NEX_BASE_ABS) === 0 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
