/* Service Worker: 代理 HTTP CDN 请求，绕过 HTTPS 页面的 Mixed Content 限制 */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // 1) 同源代理路径: /__cdn?u=<encoded 真实 CDN 地址>
  const selfu = new URL(url);
  if (selfu.pathname !== '/__cdn') return;

  const encoded = selfu.searchParams.get('u');
  if (!encoded) {
    event.respondWith(new Response('missing u', { status: 400 }));
    return;
  }

  event.respondWith((async () => {
    let target = encoded;

    // 2) 直接命中 CDN 域名(以防页面直接 fetch 原地址)
    if (!/^https?:\/\//i.test(target)) target = url;
    target = target.replace(/^https:\/\//i, 'http://');

    try {
      const u = new URL(target);
      u.searchParams.delete('_t');
      const tail = u.searchParams.get('_');
      if (tail && /^[0-9]+\.[a-z0-9]+$/.test(tail)) u.searchParams.delete('_');
      target = u.toString();
    } catch (e) {}

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    req.signal.addEventListener('abort', onAbort);

    try {
      const resp = await fetch(target, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl.signal
      });

      // 构造一个同源的可读响应，页面 fetch 不会再被 Mixed Content 拦
      const headers = new Headers();
      headers.set('Content-Type', resp.headers.get('content-type') || 'video/mp2t');
      const cd = resp.headers.get('content-length');
      if (cd) headers.set('X-Proxy-Content-Length', cd);
      headers.set('X-Proxy-Status', String(resp.status));

      return new Response(resp.body, {
        status: 200,
        statusText: 'OK',
        headers: headers
      });
    } catch (err) {
      return new Response('', { status: 502, statusText: 'Proxy Error' });
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  })());
});