import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();

    // List of mirror domains to try in order
    const domains = [
      playerUrl,
      "https://vekna402las.com",
      "https://vekna402las.net", // Possible new mirror
      "https://allmovieland.link",
      "https://allmovieland.io",
      "https://allmovieland.net"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://allmovieland.link/", // Some mirrors require a consistent referer
      "Origin": "https://allmovieland.link"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      // Try multiple path variants as providers often update protection
      const paths = [
        `/play/${id}`,
        `/movie/${id}`,
        `/embed/${id}`,
        `/v/${id}`
      ];

      for (const path of paths) {
        const targetUrl = `${currentDomain}${path}`;
        try {
          console.log(`[getInfo] Fetching via Tor from: ${targetUrl}`);
          const response = await axios.get(targetUrl, {
            headers,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 20000,
            validateStatus: (status) => status === 200
          });

          const html = response.data;
          const $ = cheerio.load(html);

          // 1. Try finding JWPlayer/Player configurations in script tags
          const scriptMatches = [
            /(?:file|link|source)["']\s*:\s*["']([^"']+)["']/,
            /(?:key)["']\s*:\s*["']([^"']+)["']/,
            /var\s+player\s+=\s+new\s+Clappr\.Player\(({[^}]+})\)/,
            /new\s+Playerjs\(([^)]+)\)/,
            /["']?file["']?\s*[:=]\s*["']([^'"]+)["']/,
            /["']?key["']?\s*[:=]\s*["']([^'"]+)["']/
          ];

          const scripts = $("script");
          let file: string | null = null;
          let key: string | null = null;

          for (let i = 0; i < scripts.length; i++) {
            const scriptText = $(scripts[i]).html();
            if (!scriptText) continue;

            if (scriptText.includes('"file"') || scriptText.includes('"key"') || scriptText.includes("'file'") || scriptText.includes("'key'")) {
              const fileMatch = scriptText.match(/["']file["']\s*:\s*["']([^"']+)["']/);
              const keyMatch = scriptText.match(/["']key["']\s*:\s*["']([^"']+)["']/);

              if (fileMatch) file = fileMatch[1];
              if (keyMatch) key = keyMatch[1];

              if (file && key) break;
            }
          }

          if (file && key) {
            console.log(`[getInfo] Found stream data on ${currentDomain}`);
            const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

            // Fetch the actual playlist data through Tor
            const playlistRes = await axios.get(playlistUrl, {
              headers: {
                ...headers,
                "X-Csrf-Token": key,
                "Referer": targetUrl // Use the exact page as referer for the data request
              },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 15000
            });

            const playlist = Array.isArray(playlistRes.data)
              ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
              : [];

            if (playlist.length > 0) {
              return { success: true, data: { playlist, key } };
            }
          }
        } catch (e: any) {
          // Log only if it's not a common 404/Timeout during rotation
          if (e.response?.status !== 404) {
            console.log(`[getInfo] Path ${path} on ${currentDomain} failed: ${e.message}`);
          }
        }
      }
    }

    return { success: false, message: "Movie not found on any available mirrors. IP might be temporarily throttled." };

  } catch (error: any) {
    console.error(`Error in getInfo:`, error?.message || error);
    return { success: false, message: `API Error: ${error.message}` };
  }
}