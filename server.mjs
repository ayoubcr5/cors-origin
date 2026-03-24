import express from 'express';
import http from 'http';
import https from 'https';

const app = express();
const MAX_REDIRECTS = 5;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

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

function safeHeaders(headers) {
  const out = { ...headers };
  delete out.host;
  delete out.connection;
  delete out['content-length'];
  delete out['transfer-encoding'];
  return out;
}

function proxyFetch(targetUrl, res, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    return res.status(500).send('Proxy Error: Too many redirects');
  }

  const client = targetUrl.protocol === 'http:' ? http : https;

  const upstreamReq = client.get(targetUrl, (upstreamRes) => {
    const status = upstreamRes.statusCode || 500;
    const location = upstreamRes.headers.location;

    if ([301, 302, 303, 307, 308].includes(status) && location) {
      const nextUrl = new URL(location, targetUrl).toString();
      return proxyFetch(nextUrl, res, redirectCount + 1);
    }

    res.writeHead(status, safeHeaders(upstreamRes.headers));
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).send(`Proxy Error: ${err.message}`);
    }
  });
}

app.get('/', (req, res) => {
  res.send('Proxy is active');
});

app.get('/api/proxy', (req, res) => {
  const targetUrl = normalizeTarget(req.query.url);

  if (!req.query.url) {
    return res.status(400).send('Missing url parameter');
  }

  if (!targetUrl) {
    return res.status(400).send(`Invalid Target URL: ${req.query.url}`);
  }

  proxyFetch(targetUrl.toString(), res);
});

app.get(/^\/api\/proxy\/(.+)$/, (req, res) => {
  const targetUrl = normalizeTarget(req.params[0]);

  if (!targetUrl) {
    return res.status(400).send(`Invalid Target URL: ${req.params[0]}`);
  }

  proxyFetch(targetUrl.toString(), res);
});

app.get(/^\/proxy\/(.+)$/, (req, res) => {
  const targetUrl = normalizeTarget(req.params[0]);

  if (!targetUrl) {
    return res.status(400).send(`Invalid Target URL: ${req.params[0]}`);
  }

  proxyFetch(targetUrl.toString(), res);
});

export default app;
