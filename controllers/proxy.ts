import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const manifestCookieJar = new Map<string, { cookie: string; timestamp: number }>();
const MANIFEST_COOKIE_TTL_MS = 30 * 60 * 1000;

function extractCookieHeader(setCookieHeader: string[] | undefined): string {
    if (!setCookieHeader || !setCookieHeader.length) return "";
    return setCookieHeader
        .map((raw) => raw.split(";")[0]?.trim())
        .filter(Boolean)
        .join("; ");
}

function getJarCookie(proxyRef: string | undefined): string {
    if (!proxyRef) return "";

    const now = Date.now();
    const direct = manifestCookieJar.get(proxyRef);
    if (direct && now - direct.timestamp <= MANIFEST_COOKIE_TTL_MS) {
        return direct.cookie;
    }

    try {
        const origin = new URL(proxyRef).origin;
        const originCookie = manifestCookieJar.get(origin);
        if (originCookie && now - originCookie.timestamp <= MANIFEST_COOKIE_TTL_MS) {
            return originCookie.cookie;
        }
    } catch { }

    return "";
}

/**
 * Proxy controller optimized for stability and reliability.
 * Reverted to pure-Tor for data integrity while keeping HLS rewriting.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 0. Safety Valve: Smart Passthrough for Fragile Audio Providers (via Tor)
    // If we detect lizer123 or similar audio hosts, we turn off all "smart" features and use Tor
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8'))) {
        console.log(`[Proxy Raw] Tor Passthrough for fragile audio: ${targetUrl}`);
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
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
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
                // Keep stream token as-is; do not auto base64-decode arbitrary tokens.
                let path = pathSegment;

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

        const getProxyHeaders = (url: string, refererOverride?: string) => {
            const uri = new URL(url);
            // Use the hint from the query param if available - MOST RELIABLE
            // This bypasses the need for the frontend to set tricky headers
            let referer = refererOverride || proxyRef || "https://allmovieland.link/";

            if (!refererOverride && !proxyRef) {
                // Dynamic Referer Intelligence (Fallback only)
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = `https://${url.includes('slime') ? 'vekna402las.com' : uri.host}/`;
                } else if (url.includes('vidsrc')) {
                    referer = "https://vidsrc.me/";
                } else if (url.includes('vidlink')) {
                    referer = "https://vidlink.pro/";
                } else if (url.includes('superembed')) {
                    referer = "https://superembed.stream/";
                } else {
                    referer = `https://${uri.host}/`;
                }
            } else {
                // Trust explicit upstream hint from getStream/manifest rewriting.
                try {
                    const proxyRefUrl = new URL(proxyRef);
                    // For cross-host segment fetches, prefer segment host referer.
                    // Some CDNs reject fragments when referer host doesn't match.
                    if (isSegment && proxyRefUrl.hostname !== uri.hostname) {
                        referer = `https://${uri.host}/`;
                    } else {
                        referer = proxyRefUrl.href;
                    }
                } catch (e) {
                    referer = `https://${uri.host}/`;
                }
            }

            let origin = `https://${uri.host}`;
            try {
                origin = new URL(referer).origin;
            } catch {
                if (!referer.endsWith('/')) referer += '/';
                origin = referer.replace(/\/$/, '');
            }

            const jarCookie = getJarCookie(proxyRef);

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
                "Host": uri.host,
                ...(jarCookie ? { "Cookie": jarCookie } : {})
            };
        };

        const tryFetch = async (useTor: boolean, refererOverride?: string) => {
            return await axios.get(targetUrl, {
                headers: getProxyHeaders(targetUrl, refererOverride),
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                responseType: isM3U8 ? 'text' : 'stream',
                timeout: isSegment ? 20000 : 25000,
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
                    try {
                        response = await tryFetch(true);
                    } catch (torErr: any) {
                        // Retry with alternate referers for strict CDN anti-hotlinking.
                        const fallbackReferers = Array.from(new Set([
                            proxyRef || "",
                            targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1),
                            `https://${new URL(targetUrl).host}/`
                        ].filter(Boolean)));

                        let lastErr: any = torErr;
                        for (const ref of fallbackReferers) {
                            try {
                                response = await tryFetch(true, ref);
                                lastErr = null;
                                break;
                            } catch (retryErr: any) {
                                lastErr = retryErr;
                            }
                        }

                        if (lastErr) {
                            // Segment-specific rescue: refresh parent manifest and retry the same segment path.
                            try {
                                if (proxyRef) {
                                    const segmentName = (() => {
                                        try {
                                            const p = new URL(targetUrl).pathname;
                                            return p.substring(p.lastIndexOf('/') + 1);
                                        } catch {
                                            return "";
                                        }
                                    })();

                                    if (segmentName) {
                                        let manifestRes;
                                        try {
                                            manifestRes = await axios.get(proxyRef, {
                                                headers: getProxyHeaders(proxyRef, proxyRef),
                                                timeout: 12000
                                            });
                                        } catch {
                                            manifestRes = await axios.get(proxyRef, {
                                                headers: getProxyHeaders(proxyRef, proxyRef),
                                                httpAgent: torAgent,
                                                httpsAgent: torAgent,
                                                timeout: 15000
                                            });
                                        }

                                        const manifestText = typeof manifestRes.data === "string"
                                            ? manifestRes.data
                                            : Buffer.from(manifestRes.data || "").toString("utf-8");

                                        const base = proxyRef.substring(0, proxyRef.lastIndexOf('/') + 1);
                                        const refreshedLine = manifestText
                                            .split('\n')
                                            .map((l: string) => l.trim())
                                            .find((l: string) => l && !l.startsWith('#') && l.includes(segmentName));

                                        if (refreshedLine) {
                                            targetUrl = refreshedLine.startsWith('http')
                                                ? refreshedLine
                                                : new URL(refreshedLine, base).href;
                                            response = await tryFetch(true, proxyRef);
                                        } else {
                                            throw lastErr;
                                        }
                                    } else {
                                        throw lastErr;
                                    }
                                } else {
                                    throw lastErr;
                                }
                            } catch {
                                throw lastErr;
                            }
                        }
                    }
                }
            } else {
                // Manifests also try direct first for faster startup, then fallback to Tor.
                try {
                    response = await tryFetch(false);
                } catch (e) {
                    console.log(`[Proxy Fallback] Direct failed for manifest. Trying Tor...`);
                    response = await tryFetch(true);
                }
            }
        } catch (finalErr: any) {
            throw finalErr;
        }

        if (!response) {
            throw new Error("Proxy fetch failed: empty upstream response");
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
            const setCookieHeader = response.headers["set-cookie"] as string[] | undefined;
            const cookieHeader = extractCookieHeader(setCookieHeader);
            if (cookieHeader) {
                manifestCookieJar.set(targetUrl, { cookie: cookieHeader, timestamp: Date.now() });
                try {
                    manifestCookieJar.set(new URL(targetUrl).origin, { cookie: cookieHeader, timestamp: Date.now() });
                } catch { }
            }

            // Sustain the referer through recursive quality tracks and segments
            // Pass the current manifest URL as parent referer for next-level requests.
            const refParam = `&proxy_ref=${encodeURIComponent(targetUrl)}`;

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
            } else {
                console.log(`[Proxy Segment Error] ${error.message} for ${targetUrl}`);
            }

        if (!res.headersSent) {
            res.status(500).send("Proxy connectivity issues. Please try refreshing.");
        }
    }
}
