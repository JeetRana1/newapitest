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

    if (!targetUrl) return res.status(400).send("Proxy Error: No URL");

    try {
        // 2. Identify file types and generate smart headers
        const isM3U8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt');
        const isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4');

        const getProxyHeaders = (url: string) => {
            const uri = new URL(url);
            let referer = "https://allmovieland.link/";

            // Slime and Vekna servers are very picky about Referers
            if (url.includes('slime') || url.includes('vekna')) {
                referer = `https://${url.includes('slime') ? 'vekna402las.com' : uri.host}/`;
            } else if (url.includes('vidsrc')) {
                referer = "https://vidsrc.me/";
            }

            return {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ''),
                "Accept": "*/*",
                "Connection": "keep-alive"
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
            // Priority 1: Tor (Security/Anonymity)
            response = await tryFetch(true);
        } catch (e: any) {
            // Priority 2: Direct Fallback (If Tor is blocked by CDN or 403/404)
            if (isSegment && (e.response?.status === 403 || e.response?.status === 404 || !e.response)) {
                console.log(`[Proxy Fallback] Tor failed (${e.response?.status || 'Timeout'}). Trying direct fetch for segment...`);
                try {
                    response = await tryFetch(false);
                } catch (fallbackErr: any) {
                    throw fallbackErr;
                }
            } else {
                throw e;
            }
        }

        // Set permissive CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        let contentType = response.headers["content-type"];

        // 3. Recursive HLS Rewriting
        if (isM3U8 || (contentType && contentType.includes('mpegurl'))) {
            let content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // If it's not a real M3U8, just send it
            if (!content.includes('#EXTM3U') && !targetUrl.includes('.txt')) {
                return res.send(content);
            }

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            const rewrittenLines = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // Handle URI="..." in tags
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        if (host && relUrl.includes(host)) return match;
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}"`;
                    });
                }

                // Handle direct URL lines
                if (!trimmed.startsWith('#')) {
                    if (host && trimmed.includes(host)) return line;
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}`;
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
        console.error(`[Proxy Fatal] ${error.message} for ${targetUrl}`);
        if (!res.headersSent) {
            res.status(500).send("Proxy connectivity issues. Please try refreshing.");
        }
    }
}
