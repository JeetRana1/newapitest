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
      "https://allmovieland.io"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
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
          console.log(`[getInfo] Checking mirror: ${targetUrl}`);

          // Use Tor for the initial page fetch and playlist - it was more stable before
          const response = await axios.get(targetUrl, {
            headers,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 15000,
            validateStatus: (s) => s === 200
          });

          const html = response.data;
          const $ = cheerio.load(html);

          let file: string | null = null;
          let key: string | null = null;

          $("script").each((_, el) => {
            const text = $(el).html() || "";
            if (!text) return;

            // Specifically unescape slashes in the script content
            const unescapedText = text.replace(/\\\//g, "/");

            const fMatch = unescapedText.match(/["'](?:file|link|source)["']\s*[:=]\s*["']([^"']+)["']/);
            const kMatch = unescapedText.match(/["'](?:key)["']\s*[:=]\s*["']([^"']+)["']/);

            if (fMatch) file = fMatch[1];
            if (kMatch) key = kMatch[1];
          });

          if (file && key) {
            const fStr = file as string;
            const kStr = key as string;
            const playlistUrl = fStr.startsWith("http") ? fStr : `${currentDomain}${fStr}`;

            console.log(`[getInfo] Found Playlist: ${playlistUrl}`);

            const playlistRes = await axios.get(playlistUrl, {
              headers: { ...headers, "X-Csrf-Token": kStr, "Referer": targetUrl },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 15000
            });

            let data = playlistRes.data;
            if (typeof data === 'string' && data.trim().startsWith('{')) {
              try { data = JSON.parse(data); } catch (e) { }
            }

            let playlist = Array.isArray(data) ? data : (data?.playlist || data?.data || []);

            // If it's a plain string (direct link), wrap it in a playlist item
            if (playlist.length === 0 && typeof data === 'string' && data.includes('http')) {
              playlist = [{ file: data, label: 'Auto' }];
            }

            const clean = playlist.filter((i: any) => i && (i.file || i.link));

            if (clean.length > 0) {
              console.log(`[getInfo] Success on ${currentDomain} (${clean.length} tracks)`);
              return { success: true, data: { playlist: clean, key: kStr } };
            }
          }
        } catch (e: any) {
          // Silent fail for 404s
        }
      }
    }

    return { success: false, message: "Stream not found. The provider might be updating. Please try again soon." };
  } catch (error: any) {
    return { success: false, message: `System Error: ${error.message}` };
  }
}