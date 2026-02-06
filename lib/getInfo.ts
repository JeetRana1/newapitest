import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    console.log(`[getInfo] Fetching via Tor: ${targetUrl}`);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link"
    };

    let response;
    try {
      response = await axios.get(targetUrl, {
        headers,
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 30000,
        validateStatus: (status) => status < 500
      });
    } catch (e: any) {
      console.log(`[getInfo] Primary mirror failed: ${e.message}`);
      return { success: false, message: "Mirror connection failed." };
    }

    if (response.status !== 200) {
      return { success: false, message: `Mirror returned status ${response.status}.` };
    }

    const html = response.data;
    const $ = cheerio.load(html);
    const scripts = $("script");

    console.log(`[getInfo] Scanning ${scripts.length} script tags...`);

    for (let i = 0; i < scripts.length; i++) {
      const scriptText = $(scripts[i]).html();
      if (!scriptText) continue;

      // More robust search for "file" and "key"
      if (scriptText.includes('"file"') && scriptText.includes('"key"')) {
        try {
          // This regex finds values even if the JSON is messy
          const fileMatch = scriptText.match(/"file"\s*:\s*"([^"]+)"/);
          const keyMatch = scriptText.match(/"key"\s*:\s*"([^"]+)"/);

          if (fileMatch && keyMatch) {
            const file = fileMatch[1];
            const key = keyMatch[1];

            console.log(`[getInfo] Found file and key! Fetching playlist...`);

            const link = file.startsWith("http") ? file : `${playerUrl.replace(/\/$/, '')}${file}`;

            const playlistRes = await axios.get(link, {
              headers: { ...headers, "X-Csrf-Token": key },
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 20000
            });

            const playlist = Array.isArray(playlistRes.data)
              ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
              : [];

            return { success: true, data: { playlist, key } };
          }
        } catch (e: any) {
          console.log(`[getInfo] Parsing error in script: ${e.message}`);
        }
      }
    }

    return { success: false, message: "Stream links (file/key) not found in page source." };

  } catch (error: any) {
    console.error(`Error in getInfo:`, error?.message || error);
    return { success: false, message: `API Error: ${error.message}` };
  }
}