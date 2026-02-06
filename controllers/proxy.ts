import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Proxy controller that handles HLS streaming, recursive playlist rewriting,
 * and smart path reconstruction for relative redirects.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host');
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 1. Smart Path Reconstruction: Handle root-level relative requests (e.g., /stream/...)
    if (!targetUrl) {
        const fullPath = req.originalUrl;
        console.log(`[Proxy] Root Trap triggered for: ${fullPath}`);

        if (fullPath.includes('/stream/')) {
            const streamPart = fullPath.substring(fullPath.indexOf('/stream/') + 8);
            // Split into segment path and query params
            const [pathSegment, query] = streamPart.split('?');

            try {
                // Try to decode if it's the provider's base64 encoded path
                let decoded = Buffer.from(pathSegment, 'base64').toString('utf-8');

                // Validate if it's a real path (heuristic)
                if (!decoded.includes('/') && !decoded.includes('.m3u8') && !decoded.includes('.ts')) {
                    decoded = pathSegment; // Treat as raw path if decoding looks like gibberish
                }

                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');
                targetUrl = decoded.startsWith('http') ? decoded : `${base}/stream/${decoded}`;
                if (query) targetUrl += `?${query}`;

                console.log(`[Proxy] Recovered target from path: ${targetUrl}`);
            } catch (e) {
                // Fallback: assume it's a raw relative path resolution from the player
                const playerUrl = await getPlayerUrl();
                targetUrl = `${playerUrl.replace(/\/$/, '')}${fullPath}`;
                console.log(`[Proxy] Fallback recovery: ${targetUrl}`);
            }
        }
    }

    if (!targetUrl) {
        return res.status(400).send("Proxy Error: No target URL provided.");
    }

    try {
        console.log(`[Proxy] Fetching: ${targetUrl}`);

        // Use a longer timeout for Tor
        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://allmovieland.link/", // Crucial for some providers
                "Origin": "https://allmovieland.link",
                "Accept": "*/*"
            },
            httpAgent: torAgent,
            httpsAgent: torAgent,
            responseType: 'stream', // Start as stream for performance
            timeout: 30000,
            validateStatus: (status) => status < 500
        });

        if (response.status !== 200) {
            console.log(`[Proxy] Backend returned ${response.status} for ${targetUrl}`);
            return res.status(response.status).send(`Stream backend error: ${response.status}`);
        }

        // 2. Identify Content-Type and decide whether to rewrite
        let contentType = (response.headers["content-type"] || "").toLowerCase();
        const isM3U8 = targetUrl.toLowerCase().includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl');
        const isKey = targetUrl.toLowerCase().includes('.key');
        const isTxt = targetUrl.toLowerCase().includes('.txt');

        // Set permissive CORS and correct content-type
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (isM3U8) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        } else if (isKey) {
            res.setHeader("Content-Type", "application/octet-stream");
        } else {
            res.setHeader("Content-Type", contentType || "video/mp2t");
        }

        // 3. Recursive Playlist Rewriting
        if (isM3U8 || isTxt) {
            // Buffer the whole playlist to rewrite links
            const chunks: any[] = [];
            for await (const chunk of response.data) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            let content = buffer.toString('utf-8');

            // If it's not a real M3U8, just send it (handles some .txt files that are just links)
            if (!content.includes('#EXTM3U') && !isTxt) {
                return res.send(content);
            }

            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            const lines = content.split('\n');
            const safeHost = host || "";
            const rewrittenLines = lines.map(line => {
                line = line.trim();
                if (!line) return line;

                // Handle URI="relative/path/segment.m3u8"
                if (line.includes('URI="')) {
                    return line.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        // Avoid double proxying
                        if (safeHost && relUrl.includes(safeHost)) return match;

                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}"`;
                    });
                }

                // Handle direct URL lines (Sub-playlists or Segments)
                if (!line.startsWith('#')) {
                    // Avoid double proxying
                    if (safeHost && line.includes(safeHost)) return line;

                    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}`;
                }

                return line;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // 4. Handle Binary/Segment Data (Pipe it!)
        console.log(`[Proxy] Piping data for ${targetUrl} (Content-Type: ${contentType})`);
        response.data.pipe(res);

        // Log when the pipe finishes
        response.data.on('end', () => {
            console.log(`[Proxy] Successfully served: ${targetUrl}`);
        });

    } catch (error: any) {
        console.error(`[Proxy Fatal Error] ${error.message} for ${targetUrl}`);
        if (!res.headersSent) {
            res.status(500).send("Streaming Proxy Bridge failed.");
        }
    }
}
