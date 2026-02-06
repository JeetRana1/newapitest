import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Proxy controller that handles HLS streaming, recursive playlist rewriting,
 * and smart path reconstruction for relative redirects.
 * Optimized for speed using a "Hybrid Accelerator" strategy.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host');
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 1. Smart Path Reconstruction: Handle root-level relative requests
    if (!targetUrl) {
        const fullPath = req.originalUrl;
        if (fullPath.includes('/stream/')) {
            const streamPart = fullPath.substring(fullPath.indexOf('/stream/') + 8);
            const [pathSegment, query] = streamPart.split('?');
            try {
                let decoded = Buffer.from(pathSegment, 'base64').toString('utf-8');
                if (!decoded.includes('/') && !decoded.includes('.m3u8') && !decoded.includes('.ts')) {
                    decoded = pathSegment;
                }
                const playerUrl = await getPlayerUrl();
                targetUrl = decoded.startsWith('http') ? decoded : `${playerUrl.replace(/\/$/, '')}/stream/${decoded}`;
                if (query) targetUrl += `?${query}`;
            } catch (e) {
                const playerUrl = await getPlayerUrl();
                targetUrl = `${playerUrl.replace(/\/$/, '')}${fullPath}`;
            }
        }
    }

    if (!targetUrl) return res.status(400).send("No target URL.");

    try {
        const isSegment = targetUrl.toLowerCase().includes('.ts') || targetUrl.toLowerCase().includes('.mp4') || targetUrl.toLowerCase().includes('.m4s');
        const isM3U8 = targetUrl.toLowerCase().includes('.m3u8') || targetUrl.toLowerCase().includes('.txt');

        console.log(`[Proxy] Request: ${isSegment ? 'SEGMENT' : 'MANIFEST'} -> ${targetUrl}`);

        const commonHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": "https://allmovieland.link/",
            "Origin": "https://allmovieland.link",
            "Accept": "*/*"
        };

        let response;

        // HYBRID ACCELERATOR:
        // Try direct fetch for segments first (90% of CDNs allow this and it's 10x faster than Tor)
        if (isSegment) {
            try {
                response = await axios.get(targetUrl, {
                    headers: commonHeaders,
                    responseType: 'stream',
                    timeout: 10000,
                    validateStatus: (s) => s === 200
                });
                console.log(`[Proxy] Direct Success: ${targetUrl}`);
            } catch (e) {
                console.log(`[Proxy] Direct Failed, falling back to Tor for segment...`);
            }
        }

        // Use Tor if direct failed or if it's a manifest (security usually tighter on manifests)
        if (!response) {
            response = await axios.get(targetUrl, {
                headers: commonHeaders,
                httpAgent: torAgent,
                httpsAgent: torAgent,
                responseType: isM3U8 ? 'stream' : 'stream',
                timeout: 30000,
                validateStatus: (status) => status < 500
            });
        }

        if (response.status !== 200) {
            return res.status(response.status).send(`Stream source error: ${response.status}`);
        }

        let contentType = (response.headers["content-type"] || "").toLowerCase();
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        // Recursive Playlist Rewriting
        if (isM3U8 || contentType.includes('mpegurl')) {
            const chunks: any[] = [];
            for await (const chunk of response.data) { chunks.push(chunk); }
            let content = Buffer.concat(chunks).toString('utf-8');

            if (!content.includes('#EXTM3U')) return res.send(content);

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const safeHost = host || "";

            const rewrittenLines = content.split('\n').map(line => {
                line = line.trim();
                if (!line) return line;

                if (line.includes('URI="')) {
                    return line.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        if (safeHost && relUrl.includes(safeHost)) return match;
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}"`;
                    });
                }

                if (!line.startsWith('#')) {
                    if (safeHost && line.includes(safeHost)) return line;
                    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}`;
                }
                return line;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // Pipe Binary/Segment Data
        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        response.data.pipe(res);

    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message}`);
        if (!res.headersSent) res.status(500).send("Proxy Bridge Error");
    }
}
