import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) {
    return res.json({ success: false, message: "Please provide a valid file and key" });
  }

  // Create cache key for the stream request
  const cacheKey = `getStream_${file}_${key}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`[getStream] Returning cached result for file: ${file.substring(0, 30)}...`);
    return res.json(cachedResult);
  }

  try {
    let finalStreamUrl = "";
    let token = file;
    let proxyRef = "";

    // 1. Manually parse token and proxy_ref (new URL() is unsafe for base64 tokens)
    if (file.includes('proxy_ref=')) {
      const parts = file.split('?');
      token = parts[0];
      if (parts[1]) {
        const searchParams = new URLSearchParams(parts[1]);
        proxyRef = searchParams.get('proxy_ref') || "";
      }
    }

    // 2. Logic Switch: Is this a direct URL or a token?
    // CRITICAL: Check for known external hosts or standard http protocol to bypass token resolution
    if (token.startsWith('http') || token.includes('lizer123') || token.includes('cdn')) {
      console.log(`[getStream] Detected direct URL: ${token}. Proxying...`);
      finalStreamUrl = token;
    } else {
      // Resolve token from mirror
      const baseDomain = (proxyRef ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
      const path = token.startsWith('~') ? token.slice(1) + ".txt" : token + ".txt";
      const playlistUrl = `${baseDomain}/playlist/${path}`;

      console.log(`[getStream] Fetching token from mirror: ${baseDomain}`);
      const response = await axios.get(playlistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Referer": baseDomain + "/",
          "X-Csrf-Token": key
        },
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 15000,
      });
      finalStreamUrl = response.data;
    }

    // 3. Wrap the final link in our CORS Proxy
    const host = req.get('host');
    const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
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
    
    const errorResult = { success: false, message: "Stream link is currently unavailable." };
    
    // Cache the error result for 2 minutes to prevent repeated requests
    cache.set(cacheKey, errorResult, 2 * 60 * 1000);
    
    res.json(errorResult);
  }
}
