import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from "socks-proxy-agent";

const torProxyUrl = (process.env.TOR_PROXY_URL || "socks5h://127.0.0.1:9050").trim();
const torAgent = torProxyUrl ? new SocksProxyAgent(torProxyUrl) : null;

function shouldFallbackDirect(err: any): boolean {
  const message = String(err?.message || "");
  const code = String(err?.code || "");

  if (message.includes("Socks5 proxy rejected connection")) return true;
  if (message.includes("HostUnreachable")) return true;
  if (message.includes("127.0.0.1:9050")) return true;

  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND"].includes(code);
}

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
    if (shouldFallbackDirect(err)) {
      console.log(`[getInfo] Tor lane failed (${err?.message || err}). Falling back to direct request.`);
      return axios.get(url, config);
    }
    throw err;
  }
}

function buildCandidatePlayerBases(primaryBase: string): string[] {
  const cleanedPrimary = primaryBase.replace(/\/$/, "");
  const fromEnv = [
    ...(process.env.INFO_PLAYER_FALLBACKS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    (process.env.PLAYER_HARDCODED_FALLBACK || "").trim(),
  ]
    .map((v) => v.replace(/\/$/, ""))
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const base of [cleanedPrimary, ...fromEnv]) {
    if (!seen.has(base)) {
      seen.add(base);
      deduped.push(base);
    }
  }
  return deduped;
}

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const candidateBases = buildCandidatePlayerBases(playerUrl);
    const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];
    const referers = (process.env.INFO_REFERERS || "https://allmovieland.link/,https://google.com/")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    let lastError: any = null;
    let lastTargetUrl = "";

    for (const base of candidateBases) {
      console.log(`[getInfo] Trying player base: ${base}`);
      for (const path of paths) {
        const targetUrl = `${base}${path}`;
        lastTargetUrl = targetUrl;
        console.log(`[getInfo] Trying path: ${targetUrl}`);

        for (const referer of referers) {
          try {
            const response = await getWithOptionalTor(targetUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ""),
                "Cache-Control": "max-age=0",
              },
              timeout: 15000,
            });

            if (response.status !== 200) continue;

            const $ = cheerio.load(response.data);
            const script = $("script").last().html();
            if (!script) continue;

            const contentMatch = script.match(/(\{[^;]+});/) || script.match(/\((\{.*\})\)/);
            if (!contentMatch || !contentMatch[1]) continue;

            const data = JSON.parse(contentMatch[1]);
            const file = data["file"];
            const key = data["key"];
            if (!file) continue;

            const link = file.startsWith("http")
              ? file
              : new URL(file, `${base}/`).toString();

            const playlistRes = await getWithOptionalTor(link, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": targetUrl,
                "X-Csrf-Token": key,
              },
              timeout: 15000,
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
          } catch (e: any) {
            console.log(`[getInfo] Failed path ${targetUrl} with referer ${referer}: ${e.message}`);
            lastError = e;
          }
        }
      }
    }

    return {
      success: false,
      message: lastError
        ? `API Error: ${lastError.message}${lastTargetUrl ? ` (last tried: ${lastTargetUrl})` : ""}`
        : "Media not found on any known paths",
    };
  } catch (error: any) {
    console.error("Error in getInfo:", error.message);
    return {
      success: false,
      message: `API Error: ${error.message}`,
    };
  }
}
