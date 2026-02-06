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
      "https://allmovieland.site"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      // Try path variants
      for (const path of [`/play/${id}`, `/movie/${id}`]) {
        const targetUrl = `${currentDomain}${path}`;
        try {
          // Optimized Hybrid Check:
          // Try direct check with a very short timeout (3s). If it's blocked, it usually hangs.
          let response;
          try {
            response = await axios.get(targetUrl, { headers, timeout: 3500, validateStatus: (s) => s === 200 });
          } catch (e) {
            // High Speed Fallback: Use Tor immediately if direct hangs/fails
            response = await axios.get(targetUrl, { headers, httpAgent: torAgent, httpsAgent: torAgent, timeout: 12000, validateStatus: (s) => s === 200 });
          }

          const $ = cheerio.load(response.data);
          let file: string | null = null;
          let key: string | null = null;

          $("script").each((_, el) => {
            const text = $(el).html() || "";
            const f = text.match(/["'](?:file|link|source)["']\s*[:=]\s*["']([^"']+)["']/);
            const k = text.match(/["'](?:key)["']\s*[:=]\s*["']([^"']+)["']/);
            if (f) file = f[1];
            if (k) key = k[1];
          });

          if (file && key) {
            const fStr = file as string;
            const kStr = key as string;
            const playlistUrl = fStr.startsWith("http") ? fStr : `${currentDomain}${fStr}`;

            const playlistRes = await axios.get(playlistUrl, {
              headers: { ...headers, "X-Csrf-Token": kStr, "Referer": targetUrl },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 10000
            });

            let data = playlistRes.data;
            if (typeof data === 'string' && data.startsWith('{')) try { data = JSON.parse(data); } catch (e) { }

            const playlist = Array.isArray(data) ? data : (data?.playlist || data?.data || []);
            const clean = playlist.filter((i: any) => i && (i.file || i.link));

            if (clean.length > 0) return { success: true, data: { playlist: clean, key } };
          }
        } catch (e) { }
      }
    }

    return { success: false, message: "Movie data extraction failed. Please try a different mirror." };
  } catch (error: any) {
    return { success: false, message: `API Error: ${error.message}` };
  }
}