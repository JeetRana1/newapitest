import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) {
    return res.json({ success: false, message: "Please provide a valid file and key" });
  }

  const path = file.startsWith('~') ? file.slice(1) + ".txt" : file + ".txt";

  try {
    const playerUrl = await getPlayerUrl();
    const playlistUrl = `${playerUrl.replace(/\/$/, '')}/playlist/${path}`;

    // 1. Fetch the actual video link from the .txt file
    const response = await axios.get(playlistUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Referer": "https://allmovieland.link/",
        "X-Csrf-Token": key
      },
      httpAgent: torAgent,
      httpsAgent: torAgent,
      timeout: 15000,
    });

    const rawLink = response.data;

    // 2. Wrap the final link in our CORS Proxy so it plays in the browser
    const proxiedLink = `https://${req.get('host')}/api/v1/proxy?url=${encodeURIComponent(rawLink)}`;

    res.json({
      success: true,
      data: {
        link: proxiedLink,
      },
    });
  } catch (err: any) {
    console.log(`[getStream] Error: ${err.message}`);
    res.json({ success: false, message: "Stream link is currently unavailable." });
  }
}
