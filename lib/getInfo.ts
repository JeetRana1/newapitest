import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];

    let lastError: any = null;

    for (const path of paths) {
      const targetUrl = `${playerUrl.replace(/\/$/, '')}${path}`;
      console.log(`[getInfo] Trying path: ${targetUrl}`);

      const referers = ["https://allmovieland.link/", "https://google.com/"];

      for (const referer of referers) {
        try {
          const requestConfig = {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": referer,
              "Origin": referer.replace(/\/$/, ''),
              "Cache-Control": "max-age=0"
            },
            timeout: 8000
          };

          let response;
          try {
            response = await axios.get(targetUrl, requestConfig);
          } catch {
            response = await axios.get(targetUrl, {
              ...requestConfig,
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 12000
            });
          }

          if (response.status === 200) {
            const $ = cheerio.load(response.data);
            const script = $("script").last().html();

            if (!script) continue;

            const contentMatch = script.match(/(\{[^;]+});/) || script.match(/\((\{.*\})\)/);
            if (!contentMatch || !contentMatch[1]) continue;

            const data = JSON.parse(contentMatch[1]);
            const file = data["file"];
            const key = data["key"];

            if (!file) continue;

            const link = file.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

            const playlistConfig = {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": targetUrl,
                "X-Csrf-Token": key
              },
              timeout: 8000
            };

            let playlistRes;
            try {
              playlistRes = await axios.get(link, playlistConfig);
            } catch {
              playlistRes = await axios.get(link, {
                ...playlistConfig,
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 12000
              });
            }

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
