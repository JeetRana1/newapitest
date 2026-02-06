import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

// Tor Proxy Agent (Tor runs on port 9050 by default in the alpine container)
const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    console.log(`[getInfo] Target URL: ${targetUrl}`);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link"
    };

    let response;

    // Attempt with Tor
    try {
      console.log(`[getInfo] Attempting fetch via Tor...`);
      response = await axios.get(targetUrl, {
        headers,
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 25000,
        validateStatus: (status) => status < 500
      });
      console.log(`[getInfo] Tor response status: ${response.status}`);
    } catch (e: any) {
      console.log(`[getInfo] Tor failed: ${e.message}. Trying direct...`);
      response = await axios.get(targetUrl, {
        headers,
        timeout: 10000,
        validateStatus: (status) => status < 500
      });
    }

    if (response.status === 404) {
      console.log(`[getInfo] 404 received. This domain might be blocking cloud/tor IPs.`);

      // FALLBACK: Try a different mirror if the first one failed with 404
      const fallbackDomains = [
        "https://allmovieland.net",
        "https://allmovieland.io",
        "https://vekna402las.com"
      ];

      for (const domain of fallbackDomains) {
        if (targetUrl.startsWith(domain)) continue;
        const fallbackUrl = `${domain}/play/${id}`;
        try {
          console.log(`[getInfo] Trying mirror: ${fallbackUrl}`);
          response = await axios.get(fallbackUrl, {
            headers,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 15000,
            validateStatus: (status) => status === 200
          });
          if (response.status === 200) break;
        } catch (err) { continue; }
      }
    }

    const html = response.data;
    if (typeof html !== 'string' || response.status !== 200) {
      return { success: false, message: `Status ${response.status}: ISP/Cloud Block Active` };
    }

    const $ = cheerio.load(html);
    const scripts = $("script");

    for (let i = 0; i < scripts.length; i++) {
      const scriptText = $(scripts[i]).html();
      if (scriptText && (scriptText.includes('file') || scriptText.includes('key'))) {
        const jsonRegex = /(\{[^{}]*\})/g;
        let match;
        while ((match = jsonRegex.exec(scriptText)) !== null) {
          try {
            const obj = JSON.parse(match[1]);
            if (obj.file && obj.key) {
              const file = obj.file;
              const key = obj.key;
              const link = file.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

              const playlistRes = await axios.get(link, {
                headers: { ...headers, "X-Csrf-Token": key },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 20000
              });

              const playlist = Array.isArray(playlistRes.data)
                ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
                : [];

              return {
                success: true,
                data: { playlist, key }
              };
            }
          } catch (e) { continue; }
        }
      }
    }

    return { success: false, message: "Stream data script not found on mirror." };

  } catch (error: any) {
    console.error(`Error in getInfo:`, error?.message || error);
    return {
      success: false,
      message: `API Error: ${error?.message || "Something went wrong"}`,
    };
  }
}