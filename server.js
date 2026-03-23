const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// 1. Configure CORS to only allow starnhl.com
const allowedOrigins = [
    'https://starnhl.com', 
    'https://www.starnhl.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps) 
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Access denied: Unauthorized Origin'));
        }
    }
};

app.use(cors(corsOptions));

// 2. Security Middleware to block non-browser/direct access
app.use((req, res, next) => {
    // Vercel sometimes passes the origin in different headers; we check both
    const origin = req.get('origin') || req.get('referer');
    
    // Check if the request is coming from your domain
    const isAllowed = allowedOrigins.some(domain => origin && origin.startsWith(domain));

    // Optional: Bypass check for the root path so you can see if the server is "alive"
    if (req.path === '/') return next();

    if (!isAllowed) {
        return res.status(403).send('Forbidden: Access allowed only from starnhl.com');
    }
    next();
});

// Root route for health check
app.get('/', (req, res) => {
    res.send('Proxy is active and secured for starnhl.com');
});

/**
 * Proxy 1: ?url= style
 * Usage: /proxy?url=https://example.com
 */
app.get('/proxy', (req, res, next) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        pathRewrite: { '^/proxy': '' },
        onProxyRes: (proxyRes) => {
            proxyRes.headers['Access-Control-Allow-Origin'] = req.get('origin') || 'https://starnhl.com';
        },
        onError: (err, req, res) => {
            res.status(500).send('Proxy Error');
        }
    })(req, res, next);
});

/**
 * Proxy 2: /url style (CORS Anywhere style)
 * Usage: /https://example.com/api/data
 */
app.use('/:targetUrl*', (req, res, next) => {
    const targetUrl = req.params.targetUrl + (req.params[0] || '');
    
    // Skip if it's a favicon or internal route
    if (!targetUrl || targetUrl === 'favicon.ico' || targetUrl.startsWith('api')) {
        return next();
    }

    // Ensure the target URL has a protocol
    const finalTarget = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;

    createProxyMiddleware({
        target: finalTarget,
        changeOrigin: true,
        pathRewrite: (path) => path.replace(/^\/[^/]+/, ''), // Removes the targetUrl from the path
        onProxyRes: (proxyRes) => {
            proxyRes.headers['Access-Control-Allow-Origin'] = req.get('origin') || 'https://starnhl.com';
        }
    })(req, res, next);
});

// CRITICAL FOR VERCEL: Export the app
module.exports = app;

// Keep this for local development (won't affect Vercel)
if (require.main === module) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => console.log(`Proxy running on port ${port}`));
}
