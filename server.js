app.use('/proxy', (req, res, next) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).send('Missing url parameter');

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).send(`Invalid Target URL: ${rawUrl}`);
  }

  req.url = parsed.pathname + parsed.search;

  return createProxyMiddleware({
    target: parsed.origin,
    changeOrigin: true,
    onProxyRes: (proxyRes) => {
      proxyRes.headers['Access-Control-Allow-Origin'] =
        req.get('origin') || 'https://starnhl.com';
    },
    onError: (err, req, res) => {
      res.status(500).send('Proxy Error');
    }
  })(req, res, next);
});
