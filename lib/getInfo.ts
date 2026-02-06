import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();

    const domains = [
      playerUrl,
      "https://vekna402las.com",
      "https://allmovieland.link",
      "https://allmovieland.work",
      "https://allmovieland.site",
      "https://allmovieland.io",
      "https://allmovieland.net"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://allmovieland.link/", // Some mirrors are very sensitive to referer
      "Origin": "https://allmovieland.link",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      // Try path variants to handle provider updates
      const paths = [`/play/${id}`, `/movie/${id}`, `/v/${id}`, `/embed/${id}`];

      for (const path of paths) {
        const targetUrl = `${currentDomain}${path}`;
        try {
          console.log(`[getInfo] Checking mirror: ${targetUrl}`);

          let response;
          try {
            // Try direct fetch first (Koyeb IP) - 5 second timeout
            response = await axios.get(targetUrl, {
              headers,
              timeout: 5000,
              validateStatus: (s) => s === 200
            });
          } catch (e) {
            // Fallback to Tor if direct fails/timed out
            console.log(`[getInfo] Direct check failed for ${currentDomain}, attempting Tor...`);
            response = await axios.get(targetUrl, {
              headers,
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 15000,
              validateStatus: (s) => s === 200
            });
          }

          const html = response.data;
          const $ = cheerio.load(html);

          let file: string | null = null;
          let key: string | null = null;

          // Scan all scripts for the streaming manifest and CSRF key
          $("script").each((_, el) => {
            const text = $(el).html() || "";
            if (!text) return;

            const fMatch = text.match(/["'](?:file|link|source)["']\s*[:=]\s*["']([^"']+)["']/);
            const kMatch = text.match(/["'](?:key)["']\s*[:=]\s*["']([^"']+)["']/);

            if (fMatch) file = fMatch[1];
            if (kMatch) key = kMatch[1];
          });

          if (file && key) {
            console.log(`[getInfo] Success! Found data on ${currentDomain}`);
            const fStr = file as string;
            const kStr = key as string;
            const playlistUrl = fStr.startsWith("http") ? fStr : `${currentDomain}${fStr}`;

            // Final playlist retrieval - ALWAYS use Tor for the API data call to protect Koyeb IP
            const playlistRes = await axios.get(playlistUrl, {
              headers: {
                ...headers,
                "X-Csrf-Token": kStr,
                "Referer": targetUrl
              },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 12000
            });

            let data = playlistRes.data;
            if (typeof data === 'string' && data.trim().startsWith('{')) {
              try { data = JSON.parse(data); } catch (e) { }
            }

            const playlist = Array.isArray(data) ? data : (data?.playlist || data?.data || []);
            const clean = playlist.filter((i: any) => i && (i.file || i.link));

            if (clean.length > 0) {
              return { success: true, data: { playlist: clean, key: kStr } };
            }
          }
        } catch (e: any) {
          // Log failures for debugging if it's not a standard 404
          if (e.response?.status !== 404) {
            console.log(`[getInfo] Mirror failed: ${targetUrl} (${e.message})`);
          }
        }
      }
    }

    return {
      success: false,
      message: "Streaming provider is currently rotating domains. Please refresh in 30 seconds."
    };

  } catch (error: any) {
    console.error(`[getInfo Fatal Error]`, error.message);
    return { success: false, message: `API Connectivity Error: ${error.message}` };
  }
}