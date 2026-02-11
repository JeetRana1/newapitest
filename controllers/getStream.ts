import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";

const torProxyUrl = (process.env.TOR_PROXY_URL || "").trim();
const torAgent = torProxyUrl ? new SocksProxyAgent(torProxyUrl) : null;
const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const STREAM_CACHE_STALE_TTL_MS = Number(process.env.STREAM_CACHE_STALE_TTL_MS || 24 * 60 * 60 * 1000);

async function getWithOptionalTor(url: string, config: any) {
  if (!torAgent) {
    return axios.get(url, config);
  }

  try {
    return await axios.get(url, {
      ...config,
      httpAgent: torAgent,
      httpsAgent: torAgent,
    });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (err?.code === "ECONNREFUSED" || message.includes("127.0.0.1:9050")) {
      console.log("[getStream] Tor unavailable. Falling back to direct request.");
      return axios.get(url, config);
    }
    throw err;
  }
}

function buildProxiedLink(req: Request, finalStreamUrl: string, proxyRef: string) {
  const host = req.get('host');
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || "https";
  const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
  return `${protocol}://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;
}

function buildCandidateBases(primaryBase: string): string[] {
  const fromEnv = [
    ...(process.env.INFO_PLAYER_FALLBACKS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    (process.env.PLAYER_HARDCODED_FALLBACK || "").trim(),
  ]
    .map((v) => v.replace(/\/$/, ""))
    .filter(Boolean);

  const seen = new Set<string>();
  const ordered = [primaryBase.replace(/\/$/, ""), ...fromEnv];
  const out: string[] = [];
  for (const base of ordered) {
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

function buildRefererCandidates(baseDomain: string): string[] {
  const fromEnv = (process.env.INFO_REFERERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const defaults = [`${baseDomain.replace(/\/$/, "")}/`, "https://allmovieland.link/"];
  return Array.from(new Set([...fromEnv, ...defaults]));
}

function normalizeUpstreamStreamUrl(baseDomain: string, raw: any): string {
  let candidate: any = raw;
  if (candidate && typeof candidate === "object") {
    candidate =
      candidate.file ??
      candidate.url ??
      candidate.src ??
      candidate.link ??
      candidate.data ??
      "";
  }
  const text = typeof candidate === "string" ? candidate.trim() : String(candidate ?? "").trim();
  if (!text) return "";
  if (text.startsWith("http")) return text;
  if (text.startsWith("/")) return new URL(text, `${baseDomain}/`).toString();
  return "";
}

function buildUpstreamTokenStreamUrl(baseDomain: string, token: string): string {
  const encodedToken = encodeURIComponent(token);
  return `${baseDomain.replace(/\/$/, "")}/stream/${encodedToken}`;
}

function buildUpstreamTokenStreamCandidates(baseDomain: string, token: string): string[] {
  const noTilde = token.startsWith("~") ? token.slice(1) : token;
  const candidates = [
    buildUpstreamTokenStreamUrl(baseDomain, token),
    buildUpstreamTokenStreamUrl(baseDomain, noTilde),
    `${baseDomain.replace(/\/$/, "")}/stream/${token}`,
    `${baseDomain.replace(/\/$/, "")}/stream/${noTilde}`,
  ];
  return Array.from(new Set(candidates));
}

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;

  if (!file || !key) {
    return res.status(400).json({ success: false, message: "Missing file or key" });
  }

  try {
    let finalStreamUrl = "";
    let token = decodeURIComponent(file);
    let proxyRef = "";
    let usedProxyRef = "";

    // Support for proxy_ref hint in token
    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");
    }

    const streamCacheKey = `stream_resolved_${proxyRef}__${token}__${key}`;
    const streamCacheStaleKey = `stream_resolved_stale_${proxyRef}__${token}__${key}`;

    const cachedStreamUrl = cache.get(streamCacheKey) as string | null;
    if (cachedStreamUrl && cachedStreamUrl.startsWith("http")) {
      const proxiedLink = buildProxiedLink(req, cachedStreamUrl, proxyRef);
      return res.json({
        success: true,
        data: { link: proxiedLink, cached: true },
      });
    }

    if (token.startsWith('http')) {
      finalStreamUrl = token;
    } else {
      const primaryBase = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
      const baseCandidates = buildCandidateBases(primaryBase);
      const tokenWithoutTilde = token.startsWith('~') ? token.slice(1) : token;
      const playlistPathCandidates = Array.from(
        new Set([tokenWithoutTilde, token, encodeURIComponent(tokenWithoutTilde), encodeURIComponent(token)])
      );
      let lastErr: any = null;
      let lastBaseTried = primaryBase;

      for (const baseDomain of baseCandidates) {
        lastBaseTried = baseDomain;
        console.log(`[getStream] Mirroring from: ${baseDomain}`);
        const referers = buildRefererCandidates(baseDomain);
        for (const path of playlistPathCandidates) {
          const playlistUrl = `${baseDomain}/playlist/${path}.txt`;
          for (const referer of referers) {
            try {
              const response = await getWithOptionalTor(playlistUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Referer": referer,
                  "Origin": referer.replace(/\/$/, ""),
                  "X-Csrf-Token": key
                },
                timeout: 15000,
              });

              const normalized = normalizeUpstreamStreamUrl(baseDomain, response.data);
              if (normalized.startsWith("http")) {
                finalStreamUrl = normalized;
                usedProxyRef = baseDomain;
                break;
              }
            } catch (err: any) {
              lastErr = err;
              console.log(`[getStream] Failed playlist fetch ${playlistUrl} with referer ${referer}: ${err.message}`);
            }
          }
          if (finalStreamUrl) break;
        }
        if (finalStreamUrl) break;
      }

      if (!finalStreamUrl) {
        // Some providers no longer return direct playlist URLs from /playlist/*.txt.
        // In that case, probe tokenized /stream variants and proxy the first reachable URL.
        const fallbackBase = proxyRef || primaryBase || lastBaseTried;
        const fallbackReferers = buildRefererCandidates(fallbackBase);
        const streamCandidates = buildUpstreamTokenStreamCandidates(fallbackBase, token);

        for (const streamUrl of streamCandidates) {
          for (const referer of fallbackReferers) {
            try {
              const response = await getWithOptionalTor(streamUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Referer": referer,
                  "Origin": referer.replace(/\/$/, ""),
                  "Accept": "*/*",
                },
                timeout: 12000,
              });

              if (response.status >= 200 && response.status < 400) {
                finalStreamUrl = streamUrl;
                usedProxyRef = fallbackBase;
                break;
              }
            } catch (err: any) {
              lastErr = err;
              console.log(`[getStream] Failed stream probe ${streamUrl} with referer ${referer}: ${err.message}`);
            }
          }
          if (finalStreamUrl) break;
        }

        const staleStreamUrl = cache.get(streamCacheStaleKey) as string | null;
        if (!finalStreamUrl && staleStreamUrl && staleStreamUrl.startsWith("http")) {
          console.log(`[getStream] Upstream fetch failed, using stale stream cache: ${lastErr?.message || "unknown error"}`);
          finalStreamUrl = staleStreamUrl;
          usedProxyRef = proxyRef;
        }
      }
    }

    if (!finalStreamUrl || typeof finalStreamUrl !== 'string' || !finalStreamUrl.startsWith('http')) {
      return res.status(500).json({ success: false, message: "Invalid stream URL received from mirror" });
    }

    cache.set(streamCacheKey, finalStreamUrl, STREAM_CACHE_TTL_MS);
    cache.set(streamCacheStaleKey, finalStreamUrl, STREAM_CACHE_STALE_TTL_MS);
    const proxiedLink = buildProxiedLink(req, finalStreamUrl, usedProxyRef || proxyRef);

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
