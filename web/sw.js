/**
 * sw.js — service worker สำหรับใช้งานขณะออฟไลน์
 *
 * ห้องเก็บของและพื้นที่หวงห้ามในอาคารผู้โดยสารมักไม่มีสัญญาณ
 * ตัวแอปทั้งหมดจึงถูกเก็บลงแคชตั้งแต่เปิดครั้งแรก เพื่อให้เปิดใช้ได้
 * แม้ไม่มีเน็ต ส่วนข้อมูลทะเบียนและผลสแกนอยู่ใน IndexedDB แยกต่างหาก
 *
 * ใช้กลยุทธ์ network-first สำหรับไฟล์แอป เพื่อให้ผู้ใช้ได้เวอร์ชันใหม่
 * ทันทีที่มีสัญญาณ โดยยังมีแคชเป็นตัวสำรองเสมอ
 */

const CACHE = 'asset-audit-v1';

const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/api.js',
  'js/config.js',
  'js/demo.js',
  'js/reconcile.js',
  'js/scanner.js',
  'js/store.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // ไฟล์เดียวโหลดไม่สำเร็จต้องไม่ทำให้ทั้งชุดล้มเหลว
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // คำขอไปยัง Apps Script ต้องไม่ถูกแคช มิฉะนั้นจะได้ข้อมูลเก่า
  if (!request.url.startsWith(self.registration.scope)) return;

  event.respondWith(
    fetch(request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match('index.html')))
  );
});
