// Gatherly Service Worker for Push Notifications

self.addEventListener('push', function(event) {
    console.log('[SW] Push received:', event);
    
    let data = { title: 'Gatherly', body: 'You have a new notification' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    const options = {
        body: data.body,
        icon: '/static/favicon-192x192.png',
        badge: '/static/favicon-192x192.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/',
            notificationId: data.notificationId
        },
        actions: data.actions || []
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', function(event) {
    console.log('[SW] Notification clicked:', event);
    
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                // If app is already open, focus it
                for (let client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.focus();
                        if (urlToOpen.includes('#notifications')) {
                            client.postMessage({ type: 'OPEN_NOTIFICATIONS' });
                        }
                        return;
                    }
                }
                // Otherwise open new window
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

// Handle messages from the main app
self.addEventListener('message', function(event) {
    console.log('[SW] Message received:', event.data);
});

// Service worker installation
self.addEventListener('install', function(event) {
    console.log('[SW] Installing service worker');
    self.skipWaiting();
});

// Service worker activation
self.addEventListener('activate', function(event) {
    console.log('[SW] Service worker activated');
    event.waitUntil(clients.claim());
});

