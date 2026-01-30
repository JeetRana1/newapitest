import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    // We'll try to find which Referer works. The player domain seems picky.
    // Try https://allmovieland.link/ first, then google.com as fallback
    let response;
    try {
      response = await axios.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://allmovieland.link/",
          "Origin": "https://allmovieland.link",
          "Cache-Control": "max-age=0"
        },
        timeout: 10000
      });
    } catch (e: any) {
      if (e.response?.status === 404) {
        // Retry with a different common referer
        console.log("404 with allmovieland.link, retrying with google...");
        response = await axios.get(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": "https://google.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          },
          timeout: 10000
        });
      } else {
        throw e;
      }
    }

    const $ = cheerio.load(response.data);
    const script = $("script").last().html()!;

    if (!script) {
      return { success: false, message: "Could not find stream data script on page" };
    }

    const content = script.match(/(\{[^;]+});/)?.[1] || script.match(/\((\{.*\})\)/)?.[1];
    if (!content) {
      return { success: false, message: "Media metadata not found in script" };
    }

    const data = JSON.parse(content);
    const file = data["file"];
    const key = data["key"];

    // Ensure the link is absolute
    const link = file?.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

    const playlistRes = await axios.get(link, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": targetUrl,
        "X-Csrf-Token": key
      },
    });

    const playlist = Array.isArray(playlistRes.data)
      ? playlistRes.data.filter((item: any) => item && item.file)
      : [];

    return {
      success: true,
      data: {
        playlist,
        key,
      },
    };
  } catch (error: any) {
    const errorUrl = error.config?.url || 'unknown url';
    console.error(`Error in getInfo at ${errorUrl}:`, error?.message || error);
    return {
      success: false,
      message: `API Error at ${errorUrl}: ${error?.message || "Something went wrong"}`,
    };
  }
}
