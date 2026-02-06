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
      "https://vekna402las.net",
      "https://allmovieland.link",
      "https://allmovieland.work",
      "https://allmovieland.site",
      "https://allmovieland.io"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      const paths = [`/play/${id}`, `/movie/${id}`, `/embed/${id}`];

      for (const path of paths) {
        const targetUrl = `${currentDomain}${path}`;
        try {
          console.log(`[getInfo] Checking: ${targetUrl}`);

          // Try fetching WITHOUT Tor first (often faster and less likely to be blocked by CDNs)
          let response;
          try {
            response = await axios.get(targetUrl, { headers, timeout: 8000, validateStatus: (s) => s === 200 });
          } catch (e) {
            // Fallback to Tor if direct fails
            console.log(`[getInfo] Direct fetch failed for ${currentDomain}, trying via Tor...`);
            response = await axios.get(targetUrl, { headers, httpAgent: torAgent, httpsAgent: torAgent, timeout: 15000, validateStatus: (s) => s === 200 });
          }

          const html = response.data;
          const $ = cheerio.load(html);

          let file: string | null = null;
          let key: string | null = null;

          const scripts = $("script");
          for (let i = 0; i < scripts.length; i++) {
            const scriptText = $(scripts[i]).html() || "";

            // Search for file/link and key with flexible regex
            const fMatch = scriptText.match(/["'](?:file|link|source)["']\s*[:=]\s*["']([^"']+)["']/);
            const kMatch = scriptText.match(/["'](?:key)["']\s*[:=]\s*["']([^"']+)["']/);

            if (fMatch) file = fMatch[1];
            if (kMatch) key = kMatch[1];

            if (file && key) break;
          }

          if (file && key) {
            console.log(`[getInfo] Stream data found! Fetching playlist...`);
            const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

            const playlistRes = await axios.get(playlistUrl, {
              headers: { ...headers, "X-Csrf-Token": key, "Referer": targetUrl },
              httpAgent: torAgent, // Always use Tor for playlist data to avoid IP blocks
              httpsAgent: torAgent,
              timeout: 12000
            });

            // Normalize playlist data (could be array or object)
            let rawData = playlistRes.data;
            if (typeof rawData === 'string' && rawData.startsWith('{')) {
              try { rawData = JSON.parse(rawData); } catch (e) { }
            }

            const playlist = Array.isArray(rawData) ? rawData : (rawData?.playlist || rawData?.data || []);
            const cleanPlaylist = Array.isArray(playlist)
              ? playlist.filter((item: any) => item && (item.file || item.folder || item.link))
              : [];

            if (cleanPlaylist.length > 0) {
              return { success: true, data: { playlist: cleanPlaylist, key } };
            }
          }
        } catch (e: any) {
          // Silently move to next if not a critical error
        }
      }
    }

    return { success: false, message: "Stream not found. The provider might have changed their security. Try again in a few minutes." };

  } catch (error: any) {
    return { success: false, message: `API Error: ${error.message}` };
  }
}