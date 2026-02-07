import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";
import * as crypto from 'crypto';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

// Function to validate if a stream URL is accessible
async function validateStreamUrl(url: string, referer: string): Promise<boolean> {
  // Try HEAD request first (more efficient)
  try {
    const response = await axios.head(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "*/*",
      },
      httpAgent: torAgent,
      httpsAgent: torAgent,
      timeout: 8000, // 8 seconds timeout for HEAD request
      maxRedirects: 3,
      validateStatus: (status) => status < 400 // Accept 2xx and 3xx as valid
    });

    // Check if the response is likely a valid stream
    const contentType = response.headers['content-type'];

    // Valid stream content types
    const validContentTypes = [
      'application/vnd.apple.mpegurl', // m3u8
      'application/x-mpegurl',         // m3u8
      'application/dash+xml',          // mpd
      'video/',                        // any video type
      'application/octet-stream',      // generic binary
      'binary/'                        // generic binary
    ];

    const isValidContentType = validContentTypes.some(type =>
      contentType && contentType.toLowerCase().includes(type)
    );

    // If content type is valid or if we can't determine (HEAD request might not return it), consider it valid
    return isValidContentType || !contentType;
  } catch (headError) {
    // If HEAD fails, try a minimal GET request with range header to check validity
    console.log(`[validateStreamUrl] HEAD request failed for ${url}, trying GET with Range header...`);
    
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Referer": referer,
          "Accept": "*/*",
          "Range": "bytes=0-1023" // Request only first 1KB to check validity
        },
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 8000, // 8 seconds timeout for GET request
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
        // Limit response size to avoid downloading entire stream
        maxContentLength: 2048, // 2KB max
        responseType: 'arraybuffer'
      });

      // Check if the response is likely a valid stream
      const contentType = response.headers['content-type'];

      // Valid stream content types
      const validContentTypes = [
        'application/vnd.apple.mpegurl', // m3u8
        'application/x-mpegurl',         // m3u8
        'application/dash+xml',          // mpd
        'video/',                        // any video type
        'application/octet-stream',      // generic binary
        'binary/'                        // generic binary
      ];

      const isValidContentType = validContentTypes.some(type =>
        contentType && contentType.toLowerCase().includes(type)
      );

      // If content type is valid or if we can't determine, consider it valid
      return isValidContentType || !contentType;
    } catch (getError) {
      console.log(`[validateStreamUrl] GET request also failed for ${url}:`, (getError as Error).message);
      return false;
    }
  }
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
    if (token.startsWith('http') || token.includes('lizer123') || token.includes('cdn')) {
      console.log(`[getStream] Detected direct URL: ${token}. Proxying...`);
      finalStreamUrl = token;
    } else {
      // Resolve token from mirror
      const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
      const path = token.startsWith('~') ? token.slice(1) : token; // Remove the ~ prefix but don't add .txt yet
      const playlistUrl = `${baseDomain}/playlist/${path}.txt`;

      console.log(`[getStream] Fetching token from mirror: ${baseDomain}`);
      console.log(`[getStream] Playlist URL: ${playlistUrl}`);
      
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
      
      // If the response is not a valid URL, it might be the actual stream URL
      if (typeof finalStreamUrl === 'string' && finalStreamUrl.startsWith('http')) {
        console.log(`[getStream] Retrieved stream URL: ${finalStreamUrl.substring(0, 100)}...`);
      } else {
        console.log(`[getStream] Retrieved non-URL data: ${JSON.stringify(finalStreamUrl).substring(0, 100)}...`);
        // If it's not a URL, treat it as the final stream URL
        finalStreamUrl = finalStreamUrl.toString();
      }
    }

    // Validate the stream URL before returning it
    const referer = proxyRef || 'https://allmovieland.link/';
    const isValidStream = await validateStreamUrl(finalStreamUrl, referer);
    
    if (!isValidStream) {
      console.log(`[getStream] Stream URL validation failed: ${finalStreamUrl.substring(0, 100)}...`);
      
      const errorResult = { 
        success: false, 
        message: "Stream URL validation failed - stream is not accessible" 
      };
      
      // Cache the error result for 2 minutes to prevent repeated requests
      cache.set(cacheKey, errorResult, 2 * 60 * 1000);
      
      return res.json(errorResult);
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
