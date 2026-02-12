import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;

function toAbsoluteStreamUrl(value: unknown, baseDomain: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("http")) return trimmed;
    if (trimmed.startsWith("/")) return `${baseDomain}${trimmed}`;
    if (trimmed.startsWith("stream/") || trimmed.startsWith("stream2/")) {
      return `${baseDomain}/${trimmed}`;
    }
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nested = obj.link || obj.url || obj.file || obj.stream || obj.data;
    if (nested) return toAbsoluteStreamUrl(nested, baseDomain);
  }

  return "";
}

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;

  if (!file || !key) {
    return res.status(400).json({ success: false, message: "Missing file or key" });
  }

  try {
    let finalStreamUrl = "";
    let token = file as string;
    try {
      token = decodeURIComponent(token);
    } catch {
      // Keep raw token if it is not URI-encoded.
    }
    // Some clients/providers may turn "+" into spaces in transit.
    token = token.replace(/ /g, "+");
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
        // Resolve token from mirror with multiple path variants.
        const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
        refererHint = `${baseDomain}/`;
        const normalized = token.startsWith('~') ? token.slice(1) : token;
        const tokenVariants = Array.from(new Set([normalized, `~${normalized}`]));
        const candidateUrls = Array.from(new Set(
          tokenVariants.flatMap((value) => {
            const encoded = encodeURIComponent(value);
            return [
              `${baseDomain}/playlist/${encoded}.txt`,
              `${baseDomain}/playlist/${encoded}`,
              `${baseDomain}/stream/${encoded}`,
              `${baseDomain}/stream/${value}`,
            ];
          })
        ));

        console.log(`[getStream] Mirroring from: ${baseDomain}`);
        const requestConfig = {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": baseDomain + "/",
            "Origin": baseDomain,
            "X-Csrf-Token": key,
            "x-csrf-token": key
          },
          timeout: 8000,
        };

        const errors: string[] = [];

        for (const url of candidateUrls) {
          let response;
          try {
            response = await axios.get(url, requestConfig);
          } catch {
            try {
              response = await axios.get(url, {
                ...requestConfig,
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 12000,
              });
            } catch (err: any) {
              errors.push(`${url} -> ${err?.message || "failed"}`);
              continue;
            }
          }

          const resolved = toAbsoluteStreamUrl(response?.data, baseDomain);
          if (resolved.startsWith("http")) {
            finalStreamUrl = resolved;
            break;
          }

          errors.push(`${url} -> invalid response`);
        }

        if (typeof finalStreamUrl === "string" && finalStreamUrl.startsWith("http")) {
          cache.set(streamCacheKey, finalStreamUrl, STREAM_CACHE_TTL_MS);
        } else {
          throw new Error(`Unable to resolve stream URL. Tried ${candidateUrls.length} candidates. Last: ${errors[errors.length - 1] || "none"}`);
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
