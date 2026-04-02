// ============================================
// Service Worker — Neuro Mines 离线缓存
// ============================================
// 工作原理：
// 1. install 事件：首次安装时，把所有游戏文件缓存到手机
// 2. fetch 事件：每次请求文件时，优先用缓存，缓存没有再走网络
// 3. activate 事件：新版本发布时，删除旧缓存
//
// 更新方式：修改 CACHE_VERSION 的数字，用户下次打开会自动更新

const CACHE_VERSION = 'scanboom-v2.2.1';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/board.js',
    './js/renderer.js',
    './js/game.js',
    './manifest.json',
    './icons/icon2-192.png',
    './icons/icon2-512.png',
];

// ========== 安装：缓存所有资源 ==========
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting()) // 立即激活，不等旧 SW 退出
    );
});

// ========== 激活：清理旧版本缓存 ==========
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_VERSION)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim()) // 立即接管所有页面
    );
});

// ========== 请求拦截：缓存优先，网络兜底 ==========
self.addEventListener('fetch', event => {
    // 只处理 GET 请求
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            // 缓存没命中 → 走网络，并把结果存入缓存
            return fetch(event.request).then(response => {
                // 只缓存成功的同源请求
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_VERSION).then(cache => {
                    cache.put(event.request, clone);
                });
                return response;
            });
        })
    );
});
