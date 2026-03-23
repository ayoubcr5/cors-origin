const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// 1. Expanded CORS for testing (You can restrict this to starnhl.com later)
app.use(cors({
    origin: true, // Allows any origin to bypass CORS for testing
    credentials: true
}));

app.get('/', (req, res) => res.send('OQEE Proxy Active'));

// 2. The Universal Proxy Handler
app.use('/:targetUrl*', (req, res, next) => {
    // Reconstruct the URL from the full path to avoid slash-collapsing issues
    let rawPath = req.url.substring(1); // Removes the leading "/"
    
    // Fix: If Vercel/Express collapsed https:// into https:/
    if (rawPath.startsWith('http:/') && !rawPath.startsWith('http://')) {
        rawPath = rawPath.replace('http:/', 'http://');
    } else if (rawPath.startsWith('https:/') && !rawPath.startsWith('https://')) {
        rawPath = rawPath.replace('https:/', 'https://');
    }

    if (!rawPath || rawPath === 'favicon.ico') return next();

    // Determine the base target (The domain)
    let targetUrl;
    try {
        const urlObj = new URL(rawPath);
        targetUrl = urlObj.origin;
    } catch (e) {
        return res.status(400).send('Invalid Target URL');
    }

    return createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        followRedirects: true,
        pathRewrite: (path) => {
            // This extracts just the path part from the full URL provided
            // e.g., from https://site.com/video.mpd, it keeps /video.mpd
            const fullUrl = path.substring(1).replace('https:/', 'https://').replace('http:/', 'http://');
            return new URL(fullUrl).pathname + new URL(fullUrl).search;
        },
        onProxyRes: (proxyRes, req, res) => {
            // CRITICAL: Overwrite CORS headers from the original server
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
            proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
            
            // For Video Streaming (.mpd, .m3u8)
            delete proxyRes.headers['content-security-policy'];
        },
        onError: (err, req, res) => {
            res.status(500).send('Proxy Error');
        }
    })(req, res, next);
});

module.exports = app;
