import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

// Tor Proxy Agent for Koyeb/Cloud deployment
const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) {
    return res.json({
      success: false,
      message: "Please provide a valid file and key",
    });
  }

  const f = file as string;
  // The system uses a ~ prefix for encoded paths, we remove it and add .txt
  const path = f.startsWith('~') ? f.slice(1) + ".txt" : f + ".txt";

  try {
    const playerUrl = await getPlayerUrl();
    const playlistUrl = `${playerUrl.replace(/\/$/, '')}/playlist/${path}`;

    console.log(`[getStream] Fetching playlist via Tor: ${playlistUrl}`);

    const response = await axios.get(playlistUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://allmovieland.link/",
        "Origin": "https://allmovieland.link",
        "X-Csrf-Token": key
      },
      httpAgent: torAgent,
      httpsAgent: torAgent,
      timeout: 15000,
    });

    console.log(`[getStream] Playlist fetched. Status: ${response.status}`);

    res.json({
      success: true,
      data: {
        link: response.data,
      },
    });
  } catch (err: any) {
    console.log(`[getStream] Error: ${err.message}`);
    // Fallback: If Tor fails, try direct once as a last resort
    try {
      const playerUrl = await getPlayerUrl();
      const playlistUrl = `${playerUrl.replace(/\/$/, '')}/playlist/${path}`;
      const directRes = await axios.get(playlistUrl, {
        headers: { "X-Csrf-Token": key },
        timeout: 5000
      });
      return res.json({ success: true, data: { link: directRes.data } });
    } catch (e) {
      res.json({
        success: false,
        message: "Media link could not be unblocked.",
      });
    }
  }
}
