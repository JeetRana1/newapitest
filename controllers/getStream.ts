import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;

  if (!file || !key) {
    return res.status(400).json({ success: false, message: "Missing file or key" });
  }

  try {
    let finalStreamUrl = "";
    let token = decodeURIComponent(file);
    let proxyRef = "";
    let refererHint = "";

    // Support for proxy_ref hint in token
    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");
    }

    if (token.startsWith('http')) {
      finalStreamUrl = token;
      if (proxyRef) {
        refererHint = proxyRef;
      } else {
        try {
          refererHint = `${new URL(finalStreamUrl).origin}/`;
        } catch {
          refererHint = "";
        }
      }
    } else {
      const streamCacheKey = `stream_url_${token}_${proxyRef || "none"}`;
      const cachedStreamUrl = cache.get(streamCacheKey);
      if (cachedStreamUrl) {
        finalStreamUrl = cachedStreamUrl;
        if (proxyRef) {
          refererHint = proxyRef;
        }
      } else {
      // New logic: fetch token from mirror
        const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
        refererHint = `${baseDomain}/`;
        const path = token.startsWith('~') ? token.slice(1) : token;
        const playlistUrl = `${baseDomain}/playlist/${path}.txt`;

        console.log(`[getStream] Mirroring from: ${baseDomain}`);
        const requestConfig = {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": baseDomain + "/",
            "X-Csrf-Token": key
          },
          timeout: 8000,
        };

        let response;
        try {
          response = await axios.get(playlistUrl, requestConfig);
        } catch {
          response = await axios.get(playlistUrl, {
            ...requestConfig,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 12000,
          });
        }

        finalStreamUrl = response.data;

        if (typeof finalStreamUrl === "string" && finalStreamUrl.startsWith("http")) {
          cache.set(streamCacheKey, finalStreamUrl, STREAM_CACHE_TTL_MS);
        }
      }
    }

    if (!finalStreamUrl || typeof finalStreamUrl !== 'string' || !finalStreamUrl.startsWith('http')) {
      return res.status(500).json({ success: false, message: "Invalid stream URL received from mirror" });
    }

    // Wrap in Proxy
    const host = req.get('host');
    const proxySuffix = refererHint ? `&proxy_ref=${encodeURIComponent(refererHint)}` : "";
    const proxiedLink = `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;

    res.json({
      success: true,
      data: {
        link: proxiedLink
      }
    });

  } catch (err: any) {
    console.error(`[getStream] Error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}
