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
      "https://allmovieland.link",
      "https://allmovieland.io",
      "https://allmovieland.net"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');
      const targetUrl = `${currentDomain}/play/${id}`;

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
        const scripts = $("script");

        for (let i = 0; i < scripts.length; i++) {
          const scriptText = $(scripts[i]).html();
          if (!scriptText) continue;

          if (scriptText.includes('"file"') && scriptText.includes('"key"')) {
            const fileMatch = scriptText.match(/"file"\s*:\s*"([^"]+)"/);
            const keyMatch = scriptText.match(/"key"\s*:\s*"([^"]+)"/);

            if (fileMatch && keyMatch) {
              const file = fileMatch[1];
              const key = keyMatch[1];

              const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

              const playlistRes = await axios.get(playlistUrl, {
                headers: { ...headers, "X-Csrf-Token": key },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 15000
              });

              const playlist = Array.isArray(playlistRes.data)
                ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
                : [];

              return { success: true, data: { playlist, key } };
            }
          }
        }
      } catch (e: any) {
        console.log(`[getInfo] Domain ${currentDomain} failed: ${e.message}`);
        continue; // Try next domain
      }
    }

    return { success: false, message: "Movie not found on any available mirrors." };

  } catch (error: any) {
    console.error(`Error in getInfo:`, error?.message || error);
    return { success: false, message: `API Error: ${error.message}` };
  }
}