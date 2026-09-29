// عامل الخدمة: يجعل تطبيق الهاتف يعمل دون إنترنت في الميدان.
// عند تعديل أي ملف ارفع رقم الإصدار حتى يُحدَّث التطبيق على الهواتف.
const VERSION = "ncdc-ss-v1.0.0";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/app.js", "./js/questions.js", "./js/scoring.js", "./js/lists.js", "./js/store.js",
  "./js/firebase-config.js", "./js/demo-data.js",
  "./assets/logo.jpg", "./icons/icon-192.png", "./icons/icon-512.png"
];
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
const RUNTIME_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const same = url.origin === location.origin;
  if (!same && !RUNTIME_HOSTS.includes(url.hostname)) return; // لا نتدخل في طلبات Firestore/Auth
  if (same && !SHELL_URLS.has(url.href.split("?")[0])) return; // ما عدا ملفات التطبيق (مثل منصة الإدارة) يمر مباشرة للشبكة
  // stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
