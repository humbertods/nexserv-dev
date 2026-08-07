/* ════════════════════════════════════════════════════════════════
   NexServ — Service Worker de notificaciones push
   Versión ROBUSTA: NO descarga la librería de Firebase por internet
   (eso fallaba con importScripts y rompía el SW). Maneja el evento
   'push' nativo directamente, así no puede fallar por ese motivo.
   Subir a la RAÍZ del sitio donde se publique este entorno
   (self.location abajo resuelve la URL real automáticamente —
   no hace falta editar esta ruta al promover DEV → PROD).
   ════════════════════════════════════════════════════════════════ */

// Derivado de la propia ubicación del SW — nunca hardcodeado. Un Service
// Worker no tiene acceso a window/NEXSERV_BASE_PATH; self.location sí, y
// siempre apunta a dónde este archivo realmente vive.
const NEX_URL  = self.location.href.replace(/firebase-messaging-sw\.js$/, '');
const NEX_ICON = NEX_URL + 'icon-192x192.png';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

// Llega un push de FCM (app cerrada o en segundo plano) → mostrar notificación
self.addEventListener('push', function (event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    try { payload = { notification: { title: 'NexServ', body: event.data ? event.data.text() : '' } }; }
    catch (e2) { payload = {}; }
  }

  const n = payload.notification || payload.data || {};
  const title = n.title || 'NexServ';
  const link = (payload.fcmOptions && payload.fcmOptions.link)
            || (payload.data && payload.data.link)
            || n.click_action || NEX_URL;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: n.body || '',
      icon: n.icon || NEX_ICON,
      badge: NEX_ICON,
      tag: 'nexserv-' + (n.tag || 'aviso'),
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: { link: link }
    })
  );
});

// Al tocar la notificación: abrir/enfocar la app
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || NEX_URL;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      // Enfocar SOLO clientes que pertenecen a este mismo scope/base
      // (NEX_URL, derivado de self.location arriba) — nunca un substring
      // como "/nexserv" que también matchea "/nexserv-dev/" y podría
      // enfocar una pestaña del otro entorno.
      for (const c of lista) {
        if (c.url.indexOf(NEX_URL) === 0 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
