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

    // 1. Clean the URL
    // Removes '/proxy/' prefix and any leading slashes
    let targetPath = req.url.replace(/^\/proxy\/?/, '');
    
    if (!targetPath) {
        res.writeHead(400);
        return res.end('Error: No target URL provided');
    }

    // 2. Ensure it's a full URL
    const initialUrl = targetPath.startsWith('http') ? targetPath : 'https://' + targetPath;

    console.log(`Proxying to: ${initialUrl}`);

    function fetchUrl(currentUrl, redirectCount = 0) {
        if (redirectCount > 5) {
            res.writeHead(500);
            return res.end('Proxy Error: Too many redirects');
        }

        try {
            const request = https.get(currentUrl, (proxyRes) => {
                // Handle Redirects
                if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                    const nextUrl = new URL(proxyRes.headers.location, currentUrl).href;
                    return fetchUrl(nextUrl, redirectCount + 1);
                }

                // Forward Headers
                const headersToForward = { ...proxyRes.headers };
                delete headersToForward['host'];
                delete headersToForward['connection'];
                delete headersToForward['content-encoding']; // Avoid double-compression issues

                res.writeHead(proxyRes.statusCode, headersToForward);
                proxyRes.pipe(res);
            });

            request.on('error', (e) => {
                console.error("Fetch Error:", e.message);
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end('Proxy Error: ' + e.message);
                }
            });

            // Set a timeout to prevent hanging
            request.setTimeout(8000, () => {
                request.destroy();
                if (!res.headersSent) {
                    res.writeHead(504);
                    res.end('Gateway Timeout');
                }
            });

        } catch (err) {
            res.writeHead(500);
            res.end('Invalid URL or Protocol');
        }
    }

    fetchUrl(initialUrl);
}
