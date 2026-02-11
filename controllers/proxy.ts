import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torProxyUrl = (process.env.TOR_PROXY_URL || "").trim();
const torAgent = torProxyUrl ? new SocksProxyAgent(torProxyUrl) : null;
const proxyDefaultReferer = (process.env.PROXY_DEFAULT_REFERER || "").trim();
const proxySlimeReferer = (process.env.PROXY_SLIME_REFERER || "").trim();
const proxyVidsrcReferer = (process.env.PROXY_VIDSRC_REFERER || "").trim();
const proxyVidlinkReferer = (process.env.PROXY_VIDLINK_REFERER || "").trim();
const proxySuperembedReferer = (process.env.PROXY_SUPEREMBED_REFERER || "").trim();

function getOriginSafe(raw: string): string | null {
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

async function buildProxyTargetCandidates(targetUrl: string, proxyRef?: string): Promise<string[]> {
    const parsed = new URL(targetUrl);
    const looksTokenizedPath = parsed.pathname.startsWith('/stream/') || parsed.pathname.startsWith('/playlist/');
    if (!looksTokenizedPath) return [targetUrl];

    const envFallbacks = [
        ...(process.env.INFO_PLAYER_FALLBACKS || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ...(process.env.PLAYER_ORIGINS || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        (() => {
            const raw = (process.env.BASE_URL || "").trim();
            if (!raw) return "";
            try {
                return new URL(raw).origin;
            } catch {
                return "";
            }
        })(),
        (process.env.PLAYER_HARDCODED_FALLBACK || "").trim(),
    ];

    let resolvedOrigin = "";
    try {
        resolvedOrigin = getOriginSafe(await getPlayerUrl()) || "";
    } catch {
        resolvedOrigin = "";
    }

    const originCandidates = [
        parsed.origin,
        proxyRef ? getOriginSafe(proxyRef) || "" : "",
        resolvedOrigin,
        ...envFallbacks.map((v) => getOriginSafe(v) || ""),
    ].filter(Boolean);

    const uniqueOrigins = Array.from(new Set(originCandidates));
    return uniqueOrigins.map((origin) => `${origin}${parsed.pathname}${parsed.search}`);
}

/**
 * Proxy controller optimized for stability and reliability.
 * Reverted to pure-Tor for data integrity while keeping HLS rewriting.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;
    const proxyCsrf = (req.query.x_csrf as string | undefined)?.trim() || "";

    // 0. Safety Valve: Smart Passthrough for Fragile Audio Providers (via Tor)
    // If we detect lizer123 or similar audio hosts, we turn off all "smart" features and use Tor
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8'))) {
        console.log(`[Proxy Raw] Tor Passthrough for fragile audio: ${targetUrl}`);
        try {
            const rawRequestConfig = {
                responseType: 'arraybuffer' as const, // Fetch as buffer to inspect content
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "cross-site",
                    "Pragma": "no-cache",
                    "Cache-Control": "no-cache"
                },
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: (status: number) => status < 400
            };

            let rawRes;
            try {
                rawRes = await axios.get(targetUrl, {
                    ...rawRequestConfig,
                    httpAgent: torAgent || undefined,
                    httpsAgent: torAgent || undefined,
                });
            } catch (err: any) {
                const message = String(err?.message || "");
                if (torAgent && (err?.code === "ECONNREFUSED" || message.includes("127.0.0.1:9050"))) {
                    console.log("[Proxy Raw] Tor unavailable. Falling back to direct request.");
                    rawRes = await axios.get(targetUrl, rawRequestConfig);
                } else {
                    throw err;
                }
            }

            // Handle Redirections properly
            const finalUrl = rawRes.request.res.responseUrl || targetUrl;
            const contentType = rawRes.headers['content-type'];

            // If it's a manifest, we MUST rewrite it to fix relative paths
            if (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || finalUrl.includes('.m3u8'))) {
                console.log(`[Proxy Raw] Detected Manifest in Passthrough. Rewriting from ${finalUrl}...`);
                let content = rawRes.data.toString('utf-8');
                const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                // Self-reference as referer for segments
                const refParam = `&proxy_ref=${encodeURIComponent(finalUrl)}`;
                const csrfParam = proxyCsrf ? `&x_csrf=${encodeURIComponent(proxyCsrf)}` : "";

                const rewrittenLines = content.split('\n').map((line: string) => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;

                    if (trimmed.startsWith('#')) return line;

                    // Rewrite segment/playlist URL
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}${csrfParam}`;
                });

                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.send(rewrittenLines.join('\n'));
            }

            // If binary/segment, send as is
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.setHeader("Content-Type", contentType || 'application/vnd.apple.mpegurl');

            return res.status(200).send(rawRes.data);
        } catch (e: any) {
            console.log(`[Proxy Raw] Failed: ${e.message}`);
            return res.status(500).send("Audio Stream Error");
        }
    }

    // 1. Root Trap: Handle relative stream requests
    if (!targetUrl) {
        const fullPath = req.originalUrl;
        if (fullPath.includes('/stream/')) {
            const streamPart = fullPath.substring(fullPath.indexOf('/stream/') + 8);
            const [pathSegment, query] = streamPart.split('?');
            try {
                // Decode base64 only when it is clearly valid and safe.
                // Opaque stream tokens often look base64-ish, so blind decode corrupts URLs.
                let path = pathSegment;
                try {
                    const normalized = pathSegment.replace(/-/g, '+').replace(/_/g, '/');
                    const hasValidAlphabet = /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
                    if (hasValidAlphabet) {
                        const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
                        const printable = /^[\x20-\x7E]+$/.test(decoded);
                        const looksLikePath = decoded.includes('/') || decoded.includes('.') || decoded.startsWith('http');
                        const roundTrip = Buffer.from(decoded, 'utf-8').toString('base64').replace(/=+$/, '') === normalized.replace(/=+$/, '');
                        if (printable && looksLikePath && roundTrip) {
                            path = decoded;
                        }
                    }
                } catch (e) { }

                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');
                targetUrl = path.startsWith('http') ? path : `${base}/stream/${path}`;
                if (query) targetUrl += `?${query}`;
            } catch (e) {
                const playerUrl = await getPlayerUrl();
                targetUrl = `${playerUrl.replace(/\/$/, '')}${fullPath}`;
            }
        }
    }

    let isSegment = false;

    if (!targetUrl) return res.status(400).send("Proxy Error: No URL");

    try {
        // 1. Extract the Referer Hint (passed from getStream or recursive HLS)
        const proxyRef = req.query.proxy_ref as string;

        // 2. Identify file types and generate smart headers
        const isM3U8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt');
        isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4');

        const getProxyHeaders = (url: string) => {
            const uri = new URL(url);
            // Use the hint from the query param if available - MOST RELIABLE
            // This bypasses the need for the frontend to set tricky headers
            let referer = proxyRef || proxyDefaultReferer || `https://${uri.host}/`;

            if (!proxyRef) {
                // Dynamic Referer Intelligence (Fallback only)
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = proxySlimeReferer || `https://${uri.host}/`;
                } else if (url.includes('vidsrc')) {
                    referer = proxyVidsrcReferer || `https://${uri.host}/`;
                } else if (url.includes('vidlink')) {
                    referer = proxyVidlinkReferer || `https://${uri.host}/`;
                } else if (url.includes('superembed')) {
                    referer = proxySuperembedReferer || `https://${uri.host}/`;
                } else {
                    referer = `https://${uri.host}/`;
                }
            } else {
                // Generic Cross-Origin Handling
                // If the target host differs from the proxy_ref host, fallback to target host
                try {
                    const proxyHost = new URL(proxyRef).hostname;
                    if (!url.includes(proxyHost)) {
                        referer = `https://${uri.host}/`;
                    }
                } catch (e) {
                    referer = `https://${uri.host}/`;
                }
            }

            if (!referer.endsWith('/')) referer += '/';
            const origin = referer.replace(/\/$/, '');

            return {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive",
                "Sec-Fetch-Dest": isSegment ? "video" : "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "DNT": "1",
                "Pragma": "no-cache",
                "Cache-Control": "no-cache",
                ...(proxyCsrf ? { "X-Csrf-Token": proxyCsrf } : {})
            };
        };

        const tryFetch = async (url: string, useTor: boolean) => {
            const shouldUseTor = useTor && !!torAgent;
            return await axios.get(url, {
                headers: getProxyHeaders(url),
                httpAgent: shouldUseTor ? torAgent || undefined : undefined,
                httpsAgent: shouldUseTor ? torAgent || undefined : undefined,
                responseType: isM3U8 ? 'text' : 'stream',
                timeout: isSegment ? 20000 : 30000, // Segments should be faster
                maxRedirects: 5,
                validateStatus: (status) => status < 400 // Only count 2xx/3xx as success
            });
        };

        let response;
        const targetCandidates = await buildProxyTargetCandidates(targetUrl, proxyRef);
        let activeTargetUrl = targetUrl;

        for (const candidateUrl of targetCandidates) {
            try {
                // Priority for segments: Try Direct FIRST for speed, then Tor Fallback
                // But if we detect a 403 (Block), we fail-fast to Tor to save time
                if (isSegment) {
                    try {
                        response = await tryFetch(candidateUrl, false);
                    } catch (e: any) {
                        if (e.message.includes('403') || e.message.includes('401')) {
                            console.log(`[Proxy Adaptive] Direct blocked (${e.message}). Switching to Tor lane...`);
                        }
                        response = await tryFetch(candidateUrl, true);
                    }
                } else {
                    try {
                        response = await tryFetch(candidateUrl, true);
                    } catch (e) {
                        console.log(`[Proxy Fallback] Tor failed for manifest. Trying direct...`);
                        response = await tryFetch(candidateUrl, false);
                    }
                }
                activeTargetUrl = candidateUrl;
                if (candidateUrl !== targetUrl) {
                    console.log(`[Proxy Recover] Switched origin: ${targetUrl} -> ${candidateUrl}`);
                }
                break;
            } catch (candidateErr: any) {
                console.log(`[Proxy Retry] Failed candidate ${candidateUrl}: ${candidateErr.message}`);
            }
        }

        if (!response) {
            throw new Error(`All proxy candidates failed for ${targetUrl}`);
        }
        targetUrl = activeTargetUrl;

        // Set permissive CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, Date");

        let contentType = response.headers["content-type"];

        // 3. Recursive HLS Rewriting (Manifests)
        if (isM3U8 || (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL')))) {
            console.log(`[Proxy Manifest] Rewriting: ${targetUrl.substring(0, 60)}...`);

            let content = "";
            if (typeof response.data === 'string') {
                content = response.data;
            } else if (Buffer.isBuffer(response.data)) {
                content = response.data.toString('utf-8');
            } else if (typeof response.data === 'object') {
                try {
                    content = JSON.stringify(response.data);
                } catch (e) {
                    content = ""; // Fallback for circular/stream objects
                }
            }

            if (!content.includes('#EXTM3U') && !targetUrl.includes('.txt')) {
                return res.send(content);
            }

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            // Sustain the referer through recursive quality tracks and segments
            const stickyRef = proxyRef || targetUrl;
            const refParam = `&proxy_ref=${encodeURIComponent(stickyRef)}`;
            const csrfParam = proxyCsrf ? `&x_csrf=${encodeURIComponent(proxyCsrf)}` : "";

            const rewrittenLines = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // 3a. Handle Quality/Audio Variant Manifests (URI="...")
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}${refParam}${csrfParam}"`;
                    });
                }

                // 3b. Handle Fragmented Video Segments (.ts) or Sub-Manifests
                // CRITICAL: Filter out garbage lines like "7" or non-file lines
                if (!trimmed.startsWith('#') && (trimmed.includes('/') || trimmed.includes('.ts') || trimmed.includes('.m3u8') || trimmed.length > 5)) {
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}${csrfParam}`;
                }

                return line;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // 4. Handle Binary/Segment Data (Piping)
        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));

        // Ensure accurate content length if provided
        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        response.data.pipe(res);

    } catch (error: any) {
        // Only log fatal errors for manifests (crucial for debugging)
        // Silence segment errors as they are retried or handled by the player
        if (!isSegment) {
            console.error(`[Proxy Fatal] ${error.message} for ${targetUrl}`);
        }

        if (!res.headersSent) {
            res.status(500).send("Proxy connectivity issues. Please try refreshing.");
        }
    }
}
