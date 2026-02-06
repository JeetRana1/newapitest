import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function proxy(req: Request, res: Response) {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
        return res.status(400).send("No URL provided");
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://allmovieland.link/",
                "Origin": "https://allmovieland.link"
            },
            httpAgent: torAgent,
            httpsAgent: torAgent,
            responseType: targetUrl.includes('.m3u8') ? 'text' : 'stream',
            timeout: 20000,
            validateStatus: (status) => status < 500
        });

        if (response.status !== 200) {
            return res.status(response.status).send("Stream source error.");
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        const contentType = response.headers["content-type"] || "application/x-mpegURL";
        res.setHeader("Content-Type", contentType);

        // If it's a playlist, we must rewrite the links inside it to also go through the proxy
        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) {
            let content = response.data as string;
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const proxyBase = `https://${req.get('host')}/api/v1/proxy?url=`;

            // Rewrite links in the .m3u8 file
            const lines = content.split('\n');
            const rewrittenLines = lines.map(line => {
                line = line.trim();
                // Skip empty lines or commented metadata lines (except those that contain URLs)
                if (!line || (line.startsWith('#') && !line.includes('URI='))) return line;

                // Handle URI="..." in metadata tags like #EXT-X-KEY or #EXT-X-MAP
                if (line.includes('URI="')) {
                    return line.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}"`;
                    });
                }

                // Handle direct URL lines (playlist or segment links)
                if (!line.startsWith('#')) {
                    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}`;
                }

                return line;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // For actual video segments (.ts or .mp4), just pipe the stream
        response.data.pipe(res);

    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message}`);
        res.status(500).send("Proxy Bridge Error.");
    }
}
