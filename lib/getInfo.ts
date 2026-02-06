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
          console.log(`[getInfo] Checking: ${targetUrl}`);

          const response = await axios.get(targetUrl, {
            headers,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 10000,
            validateStatus: (s) => s === 200
          });

          const $ = cheerio.load(response.data);
          let scriptContent = "";
          $("script").each((_, el) => { scriptContent += $(el).html() + "\n"; });

          // The provider often uses 'file', 'link', or 'source' in a script tag
          const fileMatch = scriptContent.match(/["']?(?:file|link|source|src)["']?\s*[:=]\s*["']([^"']+)["']/i);
          const keyMatch = scriptContent.match(/["']?(?:key)["']?\s*[:=]\s*["']([^"']+)["']/i);

          if (fileMatch && keyMatch) {
            let file = fileMatch[1].replace(/\\\//g, "/");
            const key = keyMatch[1];
            const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

            console.log(`[getInfo] Found stream at ${currentDomain}`);

            const playlistRes = await axios.get(playlistUrl, {
              headers: { ...headers, "X-Csrf-Token": key, "Referer": targetUrl },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 10000
            });

            let data = playlistRes.data;
            let playlist: any[] = [];

            // Hanlde base64 encoded strings
            if (typeof data === 'string' && data.length > 30 && !data.includes('http') && !data.includes('{')) {
              try {
                const decoded = Buffer.from(data, 'base64').toString('utf-8');
                if (decoded.includes('http') || decoded.includes('{') || decoded.startsWith('[')) data = decoded;
              } catch (e) { }
            }

            if (Array.isArray(data)) {
              playlist = data;
            } else if (typeof data === 'object' && data !== null) {
              playlist = data.playlist || data.data || [];
            } else if (typeof data === 'string') {
              if (data.includes('http')) {
                playlist = [{ file: data, label: 'Auto' }];
              } else {
                try {
                  const jsonData = JSON.parse(data);
                  playlist = Array.isArray(jsonData) ? jsonData : (jsonData.playlist || jsonData.data || []);
                } catch (e) { }
              }
            }

            if (playlist.length > 0) {
              return { success: true, data: { playlist, key } };
            }
          }
        } catch (e) { }
      }
    }

    return { success: false, message: "Stream not found. The mirror might be blocked or down." };
  } catch (error: any) {
    return { success: false, message: `API Error: ${error.message}` };
  }
}