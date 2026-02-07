import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Proxy controller optimized for stability and reliability.
 * Reverted to pure-Tor for data integrity while keeping HLS rewriting.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 0. Safety Valve: Raw Passthrough for Fragile Audio Providers
    // If we detect lizer123 or similar audio hosts, we turn off all "smart" features
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8'))) {
        console.log(`[Proxy Raw] Passthrough for fragile audio: ${targetUrl}`);
        try {
            const rawRes = await axios.get(targetUrl, {
                responseType: 'stream',
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Accept": "*/*"
                }
            });

            // Set basic CORS
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.setHeader("Content-Type", rawRes.headers['content-type'] || 'application/vnd.apple.mpegurl');

            return rawRes.data.pipe(res);
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
                // Try decoding base64 if needed
                let path = pathSegment;
                try {
                    const decoded = Buffer.from(pathSegment, 'base64').toString('utf-8');
                    if (decoded.includes('/') || decoded.includes('.')) path = decoded;
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
            let referer = proxyRef || "https://allmovieland.link/";

            if (!proxyRef) {
                // Dynamic Referer Intelligence (Fallback only)
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = `https://${url.includes('slime') ? 'vekna402las.com' : uri.host}/`;
                } else if (url.includes('vidsrc')) {
                    referer = "https://vidsrc.me/";
                } else if (url.includes('vidlink')) {
                    referer = "https://vidlink.pro/";
                } else if (url.includes('superembed')) {
                    referer = "https://superembed.stream/";
                } else if (url.includes('lizer123')) {
                    // specific fix for external audio hosts
                    referer = "https://lizer123.site/";
                } else {
                    referer = `https://${uri.host}/`;
                }
            } else {
                // If the proxyRef (e.g. vekna) doesn't match the current target host (e.g. lizer123),
                // and the target is an external audio host, we must override the referer.
                if (url.includes('lizer123') || url.includes('cdn')) {
                    // check if cross-origin
                    if (!url.includes(new URL(proxyRef).hostname)) {
                        referer = `https://${uri.host}/`;
                    }
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
                "Host": uri.host
            };
        };

        const tryFetch = async (useTor: boolean) => {
            return await axios.get(targetUrl, {
                headers: getProxyHeaders(targetUrl),
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                responseType: isM3U8 ? 'text' : 'stream',
                timeout: isSegment ? 20000 : 30000, // Segments should be faster
                maxRedirects: 5,
                validateStatus: (status) => status < 400 // Only count 2xx/3xx as success
            });
        };

        let response;
        try {
            // Priority for segments: Try Direct FIRST for speed, then Tor Fallback
            // But if we detect a 403 (Block), we fail-fast to Tor to save time
            if (isSegment) {
                try {
                    // Try Direct First
                    response = await tryFetch(false);
                } catch (e: any) {
                    // If blocked (403), immediately switch to Tor
                    if (e.message.includes('403') || e.message.includes('401')) {
                        console.log(`[Proxy Adaptive] Direct blocked (${e.message}). Switching to Tor lane...`);
                    }
                    response = await tryFetch(true);
                }
            } else {
                // Manifests always try Tor first for privacy
                try {
                    response = await tryFetch(true);
                } catch (e) {
                    console.log(`[Proxy Fallback] Tor failed for manifest. Trying direct...`);
                    response = await tryFetch(false);
                }
            }
        } catch (finalErr: any) {
            throw finalErr;
        }

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
            const refParam = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";

            const rewrittenLines = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // 3a. Handle Quality/Audio Variant Manifests (URI="...")
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}${refParam}"`;
                    });
                }

                // 3b. Handle Fragmented Video Segments (.ts) or Sub-Manifests
                // CRITICAL: Filter out garbage lines like "7" or non-file lines
                if (!trimmed.startsWith('#') && (trimmed.includes('/') || trimmed.includes('.ts') || trimmed.includes('.m3u8') || trimmed.length > 5)) {
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
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
