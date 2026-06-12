const CACHE_NAME = 'casino-fenix-v4'; // Subimos la versión para forzar actualización
const ASSETS = [
    '/',
    '/index.html',
    '/css/index.css' // ✅ Corregido: index.css en lugar de style.css
];

// Instalar el Service Worker y guardar archivos básicos en caché
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Usamos un catch interno para que si falta algún archivo secundario, el SW NO se rompa
            return cache.addAll(ASSETS).catch(err => console.log("Aviso de caché controlado:", err));
        }).then(() => self.skipWaiting())
    );
});

// Activar el Service Worker y borrar cachés viejos
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Responder desde la caché o ir a la red si no está
self.addEventListener('fetch', (e) => {
    // 🔥 IMPORTANTE: No interferir con llamadas de sockets ni de la API del servidor
    if (e.request.url.includes('socket.io') || e.request.url.includes('/admin') || e.request.url.includes('/api/')) {
        return;
    }
    
    e.respondWith(
        caches.match(e.request).then((res) => {
            return res || fetch(e.request);
        })
    );
});

// =================================================================
// 🎰 EVENTO PUSH: ESCUCHA LAS ALERTAS ENVIADAS DESDE EL BACKEND
// =================================================================
self.addEventListener('push', function(event) {
    let data = { title: '🎰 Casino Fénix 🦅', body: '¡Tenés un premio o notificación en tu cuenta!' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/images/logo-192.png', // Asegurate de que esta ruta o un logo exista
        badge: '/images/logo-192.png',
        vibrate: [200, 100, 200],
        data: { url: '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Al hacer clic en la notificación flotante, redirige al usuario al casino
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
