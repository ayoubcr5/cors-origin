const MAX_REDIRECTS = 5;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length'
]);

function makeCorsHeaders(headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', '*');
  return headers;
}

function decodeRepeatedly(value, max = 3) {
  let current = String(value || '').trim();

  for (let i = 0; i < max; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }

  return current;
}

function normalizeTarget(raw) {
  const decoded = decodeRepeatedly(raw);
  if (!decoded) return null;

  const full = /^https?:\/\//i.test(decoded)
    ? decoded
    : `https://${decoded.replace(/^\/+/, '')}`;

  try {
    return new URL(full);
  } catch {
    return null;
  }
}

function buildProxyUrl(requestUrl, absoluteUrl) {
  const base = new URL(requestUrl);
  return `${base.origin}/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
}

function filterResponseHeaders(inputHeaders) {
  const headers = new Headers(inputHeaders);

  for (const key of [...headers.keys()]) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.delete(key);
    }
  }

  return makeCorsHeaders(headers);
}

async function fetchWithRedirects(targetUrl, request, depth = 0) {
  if (depth > MAX_REDIRECTS) {
    return new Response('Proxy Error: Too many redirects', { status: 500 });
  }

  const upstream = await fetch(targetUrl.toString(), {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0',
      'accept': request.headers.get('accept') || '*/*'
    }
  });

  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get('location');
    if (location) {
      const nextUrl = new URL(location, targetUrl);
      return fetchWithRedirects(nextUrl, request, depth + 1);
    }
  }

  const headers = filterResponseHeaders(upstream.headers);
  const location = upstream.headers.get('location');

  if (location) {
    try {
      const absolute = new URL(location, targetUrl).toString();
      headers.set('location', buildProxyUrl(request.url, absolute));
    } catch {
      // keep original if parsing fails
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: makeCorsHeaders()
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Proxy is active', {
        status: 200,
        headers: makeCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8' }))
      });
    }

    let rawTarget = url.searchParams.get('url');

    if (!rawTarget && url.pathname.startsWith('/api/proxy/')) {
      rawTarget = url.pathname.slice('/api/proxy/'.length);
    }

    if (!rawTarget && url.pathname.startsWith('/proxy/')) {
      rawTarget = url.pathname.slice('/proxy/'.length);
    }

    if (!rawTarget && url.pathname === '/api/proxy') {
      return new Response('Missing url parameter', {
        status: 400,
        headers: makeCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8' }))
      });
    }

    if (!rawTarget) {
      return new Response('Missing url parameter', {
        status: 400,
        headers: makeCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8' }))
      });
    }

    const targetUrl = normalizeTarget(rawTarget);

    if (!targetUrl) {
      return new Response(`Invalid Target URL: ${rawTarget}`, {
        status: 400,
        headers: makeCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8' }))
      });
    }

    try {
      return await fetchWithRedirects(targetUrl, request);
    } catch (error) {
      return new Response(`Proxy Error: ${error.message}`, {
        status: 500,
        headers: makeCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8' }))
      });
    }
  }
};
