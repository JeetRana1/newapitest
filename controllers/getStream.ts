import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";
import * as crypto from 'crypto';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
};

// Try validating a stream URL using Tor first, then direct as fallback. Returns details for diagnostics.
async function tryValidateUrl(url: string, referer: string): Promise<{ ok: boolean; status?: number; snippet?: string; via?: 'tor' | 'direct' | 'none' }> {
  const headersBase = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Referer": referer,
    "Accept": "*/*",
  };

  const tryHeadOrRange = async (useTor: boolean) => {
    try {
      // Try HEAD first
      await axios.head(url, {
        headers: { ...headersBase, "Accept-Encoding": "identity" },
        httpAgent: useTor ? torAgent : undefined,
        httpsAgent: useTor ? torAgent : undefined,
        timeout: 8000,
        maxRedirects: 3,
        validateStatus: (status) => status < 400
      });
      return { ok: true, via: (useTor ? 'tor' : 'direct') as 'tor' | 'direct' };
    } catch (headErr) {
      // HEAD failed — try minimal GET
      try {
        const r = await axios.get(url, {
          headers: { ...headersBase, "Range": "bytes=0-1" },
          httpAgent: useTor ? torAgent : undefined,
          httpsAgent: useTor ? torAgent : undefined,
          timeout: 8000,
          maxRedirects: 3,
          validateStatus: (status) => status < 400,
          maxContentLength: 1024,
          responseType: 'arraybuffer'
        });

        let snippet = '';
        try {
          snippet = typeof r.data === 'string' ? r.data.substring(0, 200) : JSON.stringify(r.data).substring(0, 200);
        } catch {
          snippet = '[unserializable snippet]';
        }

        return { ok: true, status: r.status, snippet, via: (useTor ? 'tor' : 'direct') as 'tor' | 'direct' };
      } catch (getErr: any) {
        return { ok: false, status: getErr.response?.status, snippet: getErr.response ? JSON.stringify(getErr.response.data).substring(0,200) : undefined, via: (useTor ? 'tor' : 'direct') as 'tor' | 'direct' };
      }
    }
  };

  // Try Tor first
  let res = await tryHeadOrRange(true);
  if (res.ok) return res;

  // Fall back to direct
  res = await tryHeadOrRange(false);
  return res;
}

// Validate stream URL with mirror and playlist-refresh strategies
async function ensureValidStream(originalUrl: string, referer: string, playlistUrl?: string): Promise<{ ok: boolean; url?: string; reason?: string; tried?: string[] }> {
  // 1) Try original URL
  const tried: string[] = [];
  const first = await tryValidateUrl(originalUrl, referer);
  tried.push(`${originalUrl} (via=${first.via} status=${first.status ?? 'unknown'})`);
  if (first.ok) return { ok: true, url: originalUrl, tried };

  // 2) If URL matches i-cdn-<n>, try mirrors (0..5)
  const icdnMatch = originalUrl.match(/(i-cdn-)(\d+)/);
  if (icdnMatch) {
    const prefix = icdnMatch[1];
    const maxMirror = 5; // try up to i-cdn-5
    for (let i = 0; i <= maxMirror; i++) {
      const candidate = originalUrl.replace(/i-cdn-\d+/, `${prefix}${i}`);
      if (candidate === originalUrl) continue;
      const r = await tryValidateUrl(candidate, referer);
      tried.push(`${candidate} (via=${r.via} status=${r.status ?? 'unknown'})`);
      if (r.ok) return { ok: true, url: candidate, tried };
    }
  }

  // 3) If we resolved from a playlist, try re-fetching the playlist to get a fresh token up to 2 times
  if (playlistUrl) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[ensureValidStream] Re-fetching playlist (attempt ${attempt}) from ${playlistUrl}`);
        const resp = await axios.get(playlistUrl, {
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": new URL(playlistUrl).origin + '/'
          },
          httpAgent: torAgent,
          httpsAgent: torAgent,
          timeout: 8000
        });

        const newUrl = typeof resp.data === 'string' ? resp.data : resp.data.toString();
        tried.push(`refetched:${newUrl.substring(0,200)}`);

        const validated = await tryValidateUrl(newUrl, referer);
        tried.push(`${newUrl} (via=${validated.via} status=${validated.status ?? 'unknown'})`);
        if (validated.ok) return { ok: true, url: newUrl, tried };
      } catch (reErr) {
        tried.push(`playlist_refetch_failed: ${getErrorMessage(reErr)}`);
      }
    }
  }

  return { ok: false, reason: 'validation_failed', tried };
}

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) {
    return res.json({ success: false, message: "Please provide a valid file and key" });
  }

  // Create cache key for the stream request (using a hash to avoid issues with special chars)
  const cacheKey = `getStream_${crypto.createHash('md5').update(file).digest('hex')}_${key}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`[getStream] Returning cached result for file`);
    return res.json(cachedResult);
  }

  try {
    let finalStreamUrl = "";
    let token = decodeURIComponent(file); // Decode the file parameter
    let proxyRef = "";

    // 1. Manually parse token and proxy_ref (new URL() is unsafe for base64 tokens)
    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      if (parts[1]) {
        const searchParams = new URLSearchParams(parts[1]);
        const proxyRefParam = searchParams.get('proxy_ref');
        if (proxyRefParam) {
          proxyRef = decodeURIComponent(proxyRefParam); // Decode the proxy reference
        }
      }
    }

    // 2. Logic Switch: Is this a direct URL or a token?
    // CRITICAL: Check for known external hosts or standard http protocol to bypass token resolution
    // Prepare variables for playlist handling and validation
    let playlistUrl: string | undefined = undefined;
    let resolvedFromPlaylist = false;

    if (token.startsWith('http') || token.includes('lizer123') || token.includes('cdn')) {
      console.log(`[getStream] Detected direct URL: ${token}. Proxying...`);
      finalStreamUrl = token;
    } else {
      // Resolve token from mirror
      const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
      const path = token.startsWith('~') ? token.slice(1) : token; // Remove the ~ prefix but don't add .txt yet
      const playlistUrlLocal = `${baseDomain}/playlist/${path}.txt`;

      console.log(`[getStream] Fetching token from mirror: ${baseDomain}`);
      console.log(`[getStream] Playlist URL: ${playlistUrlLocal}`);
      
      const response = await axios.get(playlistUrlLocal, {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "Referer": baseDomain + "/",
          "X-Csrf-Token": key
        },
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 15000,
      });
      
      finalStreamUrl = response.data;
      // Mark that we resolved from a playlist and keep playlist URL for possible re-fetching
      resolvedFromPlaylist = true;
      playlistUrl = playlistUrlLocal;
      
      // If the response is not a valid URL, it might be the actual stream URL
      if (typeof finalStreamUrl === 'string' && finalStreamUrl.startsWith('http')) {
        console.log(`[getStream] Retrieved stream URL: ${finalStreamUrl.substring(0, 100)}...`);
      } else {
        console.log(`[getStream] Retrieved non-URL data: ${JSON.stringify(finalStreamUrl).substring(0, 100)}...`);
        // If it's not a URL, treat it as the final stream URL
        finalStreamUrl = finalStreamUrl.toString();
      }
    }

    // Skip validation for a small set of hosts that are known to break HEAD requests
    // Note: slime403heq is intentionally NOT skipped so we can try mirrors and refetch.
    const skipValidation = finalStreamUrl.includes('lizer123') || finalStreamUrl.includes('getm3u8');

    if (!skipValidation) {
      const referer = proxyRef || 'https://allmovieland.link/';
      const validation = await ensureValidStream(finalStreamUrl, referer, typeof playlistUrl !== 'undefined' ? playlistUrl : undefined);

      if (!validation.ok) {
        console.log(`[getStream] Stream URL validation failed after tries: ${validation.tried?.slice(0,6).join(' | ')}`);

        const errorResult = {
          success: false,
          message: "Stream URL validation failed - stream is not accessible",
          details: { tried: validation.tried }
        };

        // Cache the error result for 2 minutes to prevent repeated requests
        cache.set(cacheKey, errorResult, 2 * 60 * 1000);

        return res.json(errorResult);
      }

      // If validation returned a different working URL (e.g., mirror or refreshed token), use it
      if (validation.url && validation.url !== finalStreamUrl) {
        console.log(`[getStream] Replacing stream URL with validated URL: ${validation.url}`);
        finalStreamUrl = validation.url;
      }
    } else {
      console.log(`[getStream] Skipping validation for known problematic URL: ${finalStreamUrl.substring(0, 100)}...`);
    }

    // 3. Wrap the final link in our CORS Proxy
    const host = req.get('host');
    const proxySuffix = proxyRef && proxyRef !== '' ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
    const proxiedLink = `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;

    const result = {
      success: true,
      data: {
        link: proxiedLink,
      },
    };

    // Cache the successful result for 10 minutes
    cache.set(cacheKey, result, 10 * 60 * 1000);

    res.json(result);
  } catch (err: any) {
    console.log(`[getStream] Error: ${err.message}`);
    console.error(`[getStream] Full error:`, err);
    
    const errorResult = { 
      success: false, 
      message: `Stream link is currently unavailable: ${err.message}` 
    };
    
    // Cache the error result for 2 minutes to prevent repeated requests
    cache.set(cacheKey, errorResult, 2 * 60 * 1000);
    
    res.json(errorResult);
  }
}
