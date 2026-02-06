import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    console.log(`Resolved Player URL: ${playerUrl}`);
    console.log(`Target URL: ${targetUrl}`);

    let response;
    // Premium headers to mimic a real desktop browser
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "DNT": "1"
    };

    // Attempt 1: Standard Referer
    try {
      console.log(`Attempt 1: Fetching with AllMovieLand Referer...`);
      response = await axios.get(targetUrl, {
        headers: { ...headers, "Referer": "https://allmovieland.link/" },
        timeout: 15000,
        validateStatus: (status) => status < 500
      });
    } catch (e: any) { console.log(`Attempt 1 failed: ${e.message}`); }

    // Attempt 2: Google Referer (Bypass attempt)
    if (!response || response.status === 404) {
      console.log("Attempt 2: Retrying with Google Referer...");
      try {
        response = await axios.get(targetUrl, {
          headers: { ...headers, "Referer": "https://www.google.com/" },
          timeout: 15000,
          validateStatus: (status) => status < 500
        });
      } catch (e: any) { console.log(`Attempt 2 failed: ${e.message}`); }
    }

    // Attempt 3: Fallback Domain
    if (!response || response.status === 404) {
      console.log(`Attempt 3: Trying hardcoded fallback URL...`);
      const fallbackUrl = `https://vekna402las.com/play/${id}`;
      try {
        response = await axios.get(fallbackUrl, {
          headers: { ...headers, "Referer": "https://allmovieland.link/" },
          timeout: 15000
        });
      } catch (e: any) {
        console.log(`Attempt 3 failed: ${e.message}`);
        throw new Error(`IP Blocked or Domain Dead. Last error: ${e.message}`);
      }
    }

    const html = response.data;
    if (typeof html !== 'string' || html.length < 500) {
      return { success: false, message: "Response too short or not HTML (likely blocked)" };
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
                headers: {
                  "User-Agent": headers["User-Agent"],
                  "Accept": "*/*",
                  "Referer": targetUrl,
                  "X-Csrf-Token": key
                },
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

    return { success: false, message: "Could not find stream data on page." };

  } catch (error: any) {
    console.error(`Error in getInfo:`, error?.message || error);
    return {
      success: false,
      message: `API Error: ${error?.message || "Something went wrong"}`,
    };
  }
}