const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// 1. Broad CORS for Streaming (Crucial for .mpd players)
app.use(cors({
    origin: '*', 
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
    exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.get('/', (req, res) => res.send('Proxy is Online'));

// 2. The Universal Proxy Logic
app.use((req, res, next) => {
    // We use req.url instead of params to avoid Express/Vercel URL decoding issues
    let targetPath = req.url.substring(1); // Remove the leading "/"

    if (!targetPath || targetPath === 'favicon.ico') return next();

    // FIX: Re-insert missing slashes if Vercel collapsed them
    if (targetPath.startsWith('https:/') && !targetPath.startsWith('https://')) {
        targetPath = targetPath.replace('https:/', 'https://');
    } else if (targetPath.startsWith('http:/') && !targetPath.startsWith('http://')) {
        targetPath = targetPath.replace('http:/', 'http://');
    }

    try {
        const urlObj = new URL(targetPath);
        
        return createProxyMiddleware({
            target: urlObj.origin,
            changeOrigin: true,
            followRedirects: true,
            // Rewrite the path to match the target's internal path
            pathRewrite: () => urlObj.pathname + urlObj.search,
            onProxyRes: (proxyRes) => {
                // Force CORS headers on the outgoing response
                proxyRes.headers['Access-Control-Allow-Origin'] = '*';
                proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
                // Remove security headers that might block the stream from playing
                delete proxyRes.headers['content-security-policy'];
                delete proxyRes.headers['x-frame-options'];
            },
            onError: (err, req, res) => {
                console.error('Proxy Error:', err);
                res.status(500).send('Proxy Error: Could not connect to target.');
            }
        })(req, res, next);
    } catch (e) {
        // If URL parsing fails, show the user what we tried to parse
        return res.status(400).send(`Invalid Target URL: ${targetPath}`);
    }
});

module.exports = app;
