import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;

    // Robust route detection: Handle cases where the URL is passed as a path (e.g. /stream/base64)
    // or as a relative path to our proxy root.
    if (!targetUrl) {
        // If the path contains "/stream/", it might be an encoded streaming URL from the provider
        const fullPath = req.originalUrl;
        const streamIndex = fullPath.indexOf('/stream/');

        if (streamIndex !== -1) {
            const part = fullPath.substring(streamIndex + 8); // After "/stream/"
            try {
                // Check if it's base64 (common in these streaming sites)
                let decoded = Buffer.from(part, 'base64').toString('utf-8');

                // If the decoded string doesn't look like a path, use the raw part
                if (!decoded.includes('/') && !decoded.includes('.m3u8')) {
                    decoded = part;
                }

                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');

                // Construct the absolute URL on the streaming server
                targetUrl = decoded.startsWith('http') ? decoded : `${base}/stream/${decoded}`;
                console.log(`[Proxy] Reconstructed URL from path: ${targetUrl}`);
            } catch (e) {
                // Fallback to raw path if decoding fails
                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');
                targetUrl = `${base}${fullPath.substring(fullPath.indexOf('/stream/'))}`;
            }
        }
    }

    if (!targetUrl) {
        return res.status(400).send("No target URL provided.");
    }

    try {
        const isPlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('.key') || targetUrl.includes('.txt');

        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://allmovieland.link/",
                "Origin": "https://allmovieland.link"
            },
            httpAgent: torAgent,
            httpsAgent: torAgent,
            responseType: isPlaylist ? 'text' : 'stream',
            timeout: 25000,
            validateStatus: (status) => status < 500
        });

        if (response.status !== 200) {
            return res.status(response.status).send(`Stream backend error: ${response.status}`);
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        const contentType = response.headers["content-type"] || "application/x-mpegURL";
        res.setHeader("Content-Type", contentType);

        // Recursive Rewriting for HLS Playlists
        if (isPlaylist || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) {
            let content = response.data as string;

            // Check if it really is an HLS manifest if we only guessed by extension
            if (!content.includes('#EXTM3U') && !isPlaylist) {
                // Not a manifest, just return it (might be a false positive contentType)
                return res.send(content);
            }

            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            // We use the full URL including /api/v1/proxy to ensure relative paths resolve to our proxy
            const host = req.get('host');
            const proxyBase = `https://${host}/api/v1/proxy?url=`;

            const lines = content.split('\n');
            const rewrittenLines = lines.map(line => {
                line = line.trim();
                if (!line) return line;

                // 1. Handle URI="..." in tags like #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
                if (line.includes('URI="')) {
                    return line.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}"`;
                    });
                }

                // 2. Handle direct URL lines (Sub-playlists or Segments)
                if (!line.startsWith('#')) {
                    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}`;
                }

                return line;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // Pipe binary data (TS segments, images, etc.)
        response.data.pipe(res);

    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message} for ${targetUrl}`);
        res.status(500).send("Streaming Proxy Bridge failed.");
    }
}
