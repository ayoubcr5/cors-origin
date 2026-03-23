const http = require('http');
const https = require('https');
const url = require('url');
const cors_anywhere = require('./lib/cors-anywhere'); // Ensure this path is correct

// --- CORS Anywhere Setup ---
const corsProxy = cors_anywhere.createServer({
    originBlacklist: parseEnvList(process.env.CORSANYWHERE_BLACKLIST),
    originWhitelist: parseEnvList(process.env.CORSANYWHERE_WHITELIST),
    requireHeader: ['origin', 'x-requested-with'],
    removeHeaders: ['cookie', 'cookie2'],
    redirectSameOrigin: true,
    httpProxyOptions: { xfwd: false },
});

function parseEnvList(env) {
    return env ? env.split(',') : [];
}

// --- The Main Handler (Router) ---
module.exports = (req, res) => {
    const { pathname } = url.parse(req.url);

    // 1. Route to CORS Anywhere
    if (pathname.startsWith('/anywhere')) {
        // Strip the '/anywhere' prefix before passing to cors-anywhere
        req.url = req.url.replace(/^\/anywhere/, '');
        return corsProxy.emit('request', req, res);
    }

    // 2. Route to Custom Proxy
    if (pathname.startsWith('/proxy')) {
        return handleCustomProxy(req, res);
    }

    // 3. Fallback
    res.statusCode = 404;
    res.end('Not Found. Use /anywhere/URL or /proxy/URL');
};

// --- Custom Proxy Logic ---
function handleCustomProxy(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // Extract target: remove "/proxy/" and ensure it starts with https://
    let targetPath = req.url.replace(/^\/proxy\/?/, '');
    if (targetPath.startsWith('/')) targetPath = targetPath.substring(1);
    
    const initialUrl = targetPath.startsWith('http') ? targetPath : 'https://' + targetPath;

    function fetchUrl(currentUrl, redirectCount = 0) {
        if (redirectCount > 5) {
            res.writeHead(500);
            return res.end('Proxy Error: Too many redirects');
        }

        https.get(currentUrl, (proxyRes) => {
            if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                const nextUrl = new URL(proxyRes.headers.location, currentUrl).href;
                return fetchUrl(nextUrl, redirectCount + 1);
            }

            const headersToForward = { ...proxyRes.headers };
            delete headersToForward['host'];
            delete headersToForward['connection'];

            res.writeHead(proxyRes.statusCode, headersToForward);
            proxyRes.pipe(res);
        }).on('error', (e) => {
            res.writeHead(500);
            res.end('Proxy Error: ' + e.message);
        });
    }

    fetchUrl(initialUrl);
}
