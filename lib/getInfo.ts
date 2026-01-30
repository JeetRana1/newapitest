import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    const response = await axios.get(targetUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Origin": "https://allmovieland.io",
        "Referer": "https://allmovieland.io/"
      },
      timeout: 10000
    });

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
    const link = file?.startsWith("http") ? file : `${playerUrl}${file}`;

    const playlistRes = await axios.get(link, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Origin": "https://allmovieland.io",
        "X-Csrf-Token": key,
        "Referer": targetUrl,
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
