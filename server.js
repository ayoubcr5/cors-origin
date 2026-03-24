const http = require('http');
const https = require('https');

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
  'host'
]);

function getRequestUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return new URL(req.url, `${proto}://${host}`);
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

  const withProtocol = /^https?:\/\//i.test(decoded)
    ? decoded
    : `https://${decoded.replace(/^\/+/, '')}`;

  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function forwardHeaders(sourceHeaders) {
  const headers = {};

  for (const [key, value] of Object.entries(sourceHeaders || {})) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  return headers;
}

function fetchUrl(targetUrl, res, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    res.writeHead(500);
    res.end('Proxy Error: Too many redirects');
    return;
  }

  const transport = targetUrl.protocol === 'http:' ? http : https;

  const upstreamReq = transport.request(
    targetUrl,
    {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: '*/*'
      }
    },
    (upstreamRes) => {
      const statusCode = upstreamRes.statusCode || 500;
      const location = upstreamRes.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        const nextUrl = new URL(location, targetUrl);
        upstreamRes.resume();
        return fetchUrl(nextUrl, res, redirectCount + 1);
      }

      const headers = forwardHeaders(upstreamRes.headers);
      setCors(res);
      res.writeHead(statusCode, headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      setCors(res);
      res.writeHead(500);
      res.end(`Proxy Error: ${err.message}`);
    }
  });

  upstreamReq.end();
}

module.exports = (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const requestUrl = getRequestUrl(req);

  if (requestUrl.pathname === '/api/proxy' || requestUrl.pathname === '/proxy') {
    const rawUrl = requestUrl.searchParams.get('url');
    if (!rawUrl) {
      res.writeHead(400);
      res.end('Missing url parameter');
      return;
    }

    const targetUrl = normalizeTarget(rawUrl);
    if (!targetUrl) {
      res.writeHead(400);
      res.end(`Invalid Target URL: ${rawUrl}`);
      return;
    }

    return fetchUrl(targetUrl, res);
  }

  const rawPathTarget = requestUrl.pathname
    .replace(/^\/api\/proxy\/?/, '')
    .replace(/^\/proxy\/?/, '');

  if (!rawPathTarget) {
    res.writeHead(200);
    res.end('Proxy is active');
    return;
  }

  const targetUrl = normalizeTarget(rawPathTarget);
  if (!targetUrl) {
    res.writeHead(400);
    res.end(`Invalid Target URL: ${rawPathTarget}`);
    return;
  }

  return fetchUrl(targetUrl, res);
};
