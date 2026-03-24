const http = require('http');
const https = require('https');

const MAX_REDIRECTS = 5;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
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

function filterHeaders(headers) {
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding'
  ]);

  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!blocked.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function proxifyLocation(req, location, currentUrl) {
  try {
    const absolute = new URL(location, currentUrl).toString();
    return `${getBaseUrl(req)}/api/proxy?url=${encodeURIComponent(absolute)}`;
  } catch {
    return location;
  }
}

function fetchUrl(req, res, targetUrl, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    res.statusCode = 500;
    res.end('Proxy Error: Too many redirects');
    return;
  }

  const client = targetUrl.protocol === 'http:' ? http : https;

  const upstreamReq = client.request(
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
        return fetchUrl(req, res, nextUrl, redirectCount + 1);
      }

      const headers = filterHeaders(upstreamRes.headers);

      if (headers.location) {
        headers.location = proxifyLocation(req, headers.location, targetUrl);
      }

      setCors(res);
      res.writeHead(statusCode, headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      setCors(res);
      res.statusCode = 500;
      res.end(`Proxy Error: ${err.message}`);
    }
  });

  upstreamReq.end();
}

module.exports = (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const baseUrl = getBaseUrl(req);
  const requestUrl = new URL(req.url, baseUrl);

  let rawTarget = requestUrl.searchParams.get('url');

  if (!rawTarget) {
    rawTarget = requestUrl.pathname
      .replace(/^\/api\/proxy\/?/, '')
      .replace(/^\/proxy\/?/, '');
  }

  if (!rawTarget) {
    res.statusCode = 400;
    res.end('Missing url parameter');
    return;
  }

  const targetUrl = normalizeTarget(rawTarget);

  if (!targetUrl) {
    res.statusCode = 400;
    res.end(`Invalid Target URL: ${rawTarget}`);
    return;
  }

  fetchUrl(req, res, targetUrl);
};
