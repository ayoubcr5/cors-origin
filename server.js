const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
  'https://starnhl.com',
  'https://www.starnhl.com'
];

const defaultOrigin = 'https://starnhl.com';

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function getRequestOrigin(req) {
  const origin = normalizeOrigin(req.get('origin'));
  if (origin) return origin;

  const referer = req.get('referer');
  if (!referer) return '';

  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

function isAllowedOrigin(origin) {
  return allowedOrigins.includes(origin);
}

function decodeRepeatedly(value, maxPasses = 3) {
  let current = String(value || '').trim();

  for (let i = 0; i < maxPasses; i += 1) {
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

function parseTargetUrl(rawValue) {
  const decoded = decodeRepeatedly(rawValue);
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

function buildProxyUrl(req, absoluteUrl) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const proxyBase = `${proto}://${host}`;

  if (req.proxyMode === 'path') {
    return `${proxyBase}/${absoluteUrl}`;
  }

  return `${proxyBase}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
}

function createDynamicProxy(targetUrl) {
  return createProxyMiddleware({
    target: targetUrl.origin,
    changeOrigin: true,
    xfwd: true,
    secure: true,
    onProxyRes:
