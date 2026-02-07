import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";
import cache from "../lib/cache";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
};

/**
 * Proxy controller optimized for stability and reliability.
 * Reverted to pure-Tor for data integrity while keeping HLS rewriting.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 0. Safety Valve: Smart Passthrough for Fragile Audio Providers (via Tor)
    // If we detect lizer123 or similar audio hosts, we turn off all "smart" features and use Tor
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8') || targetUrl.includes('slime403heq'))) {
        console.log(`[Proxy Raw] Tor Passthrough for fragile stream: ${targetUrl}`);
        
        // Check cache for this specific URL
        const cacheKey = `proxy_${targetUrl}`;
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            console.log(`[Proxy Raw] Returning cached result for: ${targetUrl}`);
            res.setHeader("Content-Type", cachedResult.contentType);
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.send(cachedResult.content);
        }
        
        try {
            const rawRes = await axios.get(targetUrl, {
                responseType: 'arraybuffer', // Fetch as buffer to inspect content
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
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: (status) => status < 400
            });

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

                const rewrittenLines = content.split('\n').map((line: string) => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;

                    if (trimmed.startsWith('#')) return line;

                    // Rewrite segment/playlist URL
                    let absUrl = trimmed;
                    if (!trimmed.startsWith('http')) {
                        try {
                            absUrl = new URL(trimmed, baseUrl).href;
                        } catch (e) {
                            // If URL construction fails, try manual concatenation
                            absUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + trimmed;
                        }
                    }
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
                });

                const result = {
                    content: rewrittenLines.join('\n'),
                    contentType: "application/vnd.apple.mpegurl"
                };
                
                // Cache the result for 5 minutes
                cache.set(cacheKey, result, 5 * 60 * 1000);
                
                res.setHeader("Content-Type", result.contentType);
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.send(result.content);
            }

            // If binary/segment, send as is
            const result = {
                content: rawRes.data,
                contentType: contentType || 'application/vnd.apple.mpegurl'
            };
            
            // Cache the result for 5 minutes
            cache.set(cacheKey, result, 5 * 60 * 1000);
            
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.setHeader("Content-Type", result.contentType);

            return res.status(200).send(result.content);
        } catch (e: any) {
            console.log(`[Proxy Raw] Failed: ${e.message}`);
            return res.status(500).send("Stream Error");
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

    // Check cache for this specific URL
    const cacheKey = `proxy_${targetUrl}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        console.log(`[Proxy] Returning cached result for: ${targetUrl}`);
        res.setHeader("Content-Type", cachedResult.contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, Date");
        return res.send(cachedResult.content);
    }

    try {
        // 1. Extract the Referer Hint (passed from getStream or recursive HLS)
        const proxyRef = req.query.proxy_ref as string;

        // 2. Identify file types and generate smart headers
        const isM3U8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt');
        isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4');

        const getProxyHeaders = (url: string) => {
            let hostname = '';
            try {
                const uri = new URL(url);
                hostname = uri.hostname;
            } catch (e) {
                // If URL parsing fails, extract hostname manually
                const match = url.match(/^https?:\/\/([^\/\?#]+)/i);
                hostname = match ? match[1] : 'localhost';
            }
            
            // Use the hint from the query param if available - MOST RELIABLE
            // This bypasses the need for the frontend to set tricky headers
            let referer = proxyRef || "https://allmovieland.link/";

            if (!proxyRef) {
                // Dynamic Referer Intelligence (Fallback only)
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = `https://${url.includes('slime') ? 'vekna402las.com' : hostname}/`;
                } else if (url.includes('vidsrc')) {
                    referer = "https://vidsrc.me/";
                } else if (url.includes('vidlink')) {
                    referer = "https://vidlink.pro/";
                } else if (url.includes('superembed')) {
                    referer = "https://superembed.stream/";
                } else {
                    referer = `https://${hostname}/`;
                }
            } else {
                // Generic Cross-Origin Handling
                // If the target host differs from the proxy_ref host, fallback to target host
                let proxyHostname = '';
                try {
                    const proxyUri = new URL(proxyRef);
                    proxyHostname = proxyUri.hostname;
                } catch (e) {
                    // If URL parsing fails, extract hostname manually
                    const match = proxyRef.match(/^https?:\/\/([^\/\?#]+)/i);
                    proxyHostname = match ? match[1] : '';
                }
                
                if (!url.includes(proxyHostname)) {
                    referer = `https://${hostname}/`;
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
                "Host": hostname
            };
        };

        const tryFetch = async (useTor: boolean) => {
            try {
                return await axios.get(targetUrl, {
                    headers: getProxyHeaders(targetUrl),
                    httpAgent: useTor ? torAgent : undefined,
                    httpsAgent: useTor ? torAgent : undefined,
                    responseType: isM3U8 ? 'text' : 'stream',
                    timeout: isSegment ? 20000 : 30000, // Segments should be faster
                    maxRedirects: 5,
                    validateStatus: (status) => status < 400 // Only count 2xx/3xx as success
                });
            } catch (error: unknown) {
                console.log(`[tryFetch] Error fetching ${targetUrl}:`, getErrorMessage(error));
                throw error;
            }
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
                // For manifests and other stream types, try both approaches
                try {
                    response = await tryFetch(true); // Try Tor first
                } catch (torError: unknown) {
                    console.log(`[Proxy Fallback] Tor failed (${getErrorMessage(torError)}). Trying direct...`);
                    response = await tryFetch(false); // Fall back to direct
                }
            }
        } catch (finalErr: any) {
            console.log(`[Proxy] Both Tor and direct failed for ${targetUrl}: ${finalErr.message}`);
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
                // For non-manifest content, send directly without caching for binary data
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
                        let absUrl = relUrl;
                        if (!relUrl.startsWith('http')) {
                            try {
                                absUrl = new URL(relUrl, baseUrl).href;
                            } catch (e) {
                                // If URL construction fails, try manual concatenation
                                absUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + relUrl;
                            }
                        }
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}${refParam}"`;
                    });
                }

                // 3b. Handle Fragmented Video Segments (.ts) or Sub-Manifests
                // CRITICAL: Filter out garbage lines like "7" or non-file lines
                if (!trimmed.startsWith('#') && (trimmed.includes('/') || trimmed.includes('.ts') || trimmed.includes('.m3u8') || trimmed.length > 5)) {
                    let absUrl = trimmed;
                    if (!trimmed.startsWith('http')) {
                        try {
                            absUrl = new URL(trimmed, baseUrl).href;
                        } catch (e) {
                            // If URL construction fails, try manual concatenation
                            absUrl = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + trimmed;
                        }
                    }
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
                }

                return line;
            });

            const result = {
                content: rewrittenLines.join('\n'),
                contentType: "application/vnd.apple.mpegurl"
            };
            
            // Cache the result for 5 minutes
            cache.set(cacheKey, result, 5 * 60 * 1000);
            
            return res.send(result.content);
        }

        // 4. Handle Binary/Segment Data (Piping)
        const responseContentType = contentType || (isSegment ? "video/mp2t" : "application/octet-stream");

        // Ensure accurate content length if provided
        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        res.setHeader("Content-Type", responseContentType);
        
        // For binary data, we can't cache it directly since it's a stream
        // So we pipe it directly without caching
        response.data.pipe(res);

    } catch (error: any) {
        // Log errors with more detail
        console.error(`[Proxy Fatal] ${error.message} for ${targetUrl}`);
        console.error(`[Proxy Error Details] Status: ${error.response?.status}, Data: ${typeof error.response?.data === 'string' ? error.response?.data.substring(0, 200) : 'non-string data'}`);
        
        if (!res.headersSent) {
            res.status(500).send("Proxy connectivity issues. Please try refreshing.");
        }
    }
}
