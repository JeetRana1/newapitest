import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torProxyUrl = (process.env.TOR_PROXY_URL || "socks5h://127.0.0.1:9050").trim();
const torAgent = torProxyUrl ? new SocksProxyAgent(torProxyUrl) : null;

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
      console.log("[getInfo] Tor unavailable. Falling back to direct request.");
      return axios.get(url, config);
    }
    throw err;
  }
}

function extractFileAndKeyFromHtml(html: string): { file: string; key?: string } | null {
  const $ = cheerio.load(html);
  const scripts = $("script")
    .map((_, el) => $(el).html() || "")
    .get()
    .filter(Boolean);

  const sources = [...scripts, html];
  for (const source of sources) {
    const fileMatch =
      source.match(/["']file["']\s*:\s*["']([^"']+)["']/) ||
      source.match(/\bfile\s*:\s*["']([^"']+)["']/);
    if (!fileMatch?.[1]) continue;

    const keyMatch =
      source.match(/["']key["']\s*:\s*["']([^"']+)["']/) ||
      source.match(/\bkey\s*:\s*["']([^"']+)["']/);

    return {
      file: fileMatch[1],
      key: keyMatch?.[1],
    };
  }

  return null;
}

export default async function getInfo(id: string) {
  try {
    const primaryPlayerUrl = await getPlayerUrl();
    const playerUrlCandidates = [
      primaryPlayerUrl,
      ...(process.env.PLAYER_ORIGINS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ].filter((value, index, arr) => arr.indexOf(value) === index);

    const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];
    const defaultReferers = playerUrlCandidates
      .map((value) => {
        try {
          return `${new URL(value).origin}/`;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    const envReferers = (process.env.INFO_REFERERS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const referers = [...defaultReferers, ...envReferers]
      .filter((value, index, arr) => arr.indexOf(value) === index);

    let lastError: any = null;

    for (const playerUrl of playerUrlCandidates) {
      for (const path of paths) {
        const targetUrl = `${playerUrl.replace(/\/$/, '')}${path}`;
        console.log(`[getInfo] Trying path: ${targetUrl}`);

        // Try with Tor first for better bypass
        if (referers.length === 0) {
          throw new Error("INFO_REFERERS is not configured and player origin could not be derived");
        }

        for (const referer of referers) {
          try {
            const response = await getWithOptionalTor(targetUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ''),
                "Cache-Control": "max-age=0"
              },
              timeout: 15000
            });

            if (response.status === 200) {
              const html = typeof response.data === "string" ? response.data : String(response.data || "");
              const payload = extractFileAndKeyFromHtml(html);
              if (!payload?.file) {
                console.log(`[getInfo] No file/key payload found on ${targetUrl}`);
                continue;
              }
              const file = payload.file;
              const key = payload.key;

              if (!file) continue;

              const link = file.startsWith("http")
                ? file
                : new URL(file, `${playerUrl.replace(/\/$/, "")}/`).toString();

              const playlistRes = await getWithOptionalTor(link, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Accept": "*/*",
                  "Referer": targetUrl,
                  ...(key ? { "X-Csrf-Token": key } : {})
                },
                timeout: 15000
              });

              const playlist = Array.isArray(playlistRes.data)
                ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
                : [];

              if (playlist.length > 0) {
                return {
                  success: true,
                  data: {
                    playlist,
                    key,
                  },
                };
              }
            }
          } catch (e: any) {
            console.log(`[getInfo] Failed path ${targetUrl} with referer ${referer}: ${e.message}`);
            lastError = e;
          }
        }
      }
    }

    return {
      success: false,
      message: lastError ? `API Error: ${lastError.message}` : "Media not found on any known paths"
    };
  } catch (error: any) {
    console.error(`Error in getInfo:`, error.message);
    return {
      success: false,
      message: `API Error: ${error.message}`,
    };
  }
}
