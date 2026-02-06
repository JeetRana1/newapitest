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

  try {
    let finalStreamUrl = "";

    // 1. Logic Switch: Is this a direct URL or a token?
    if (file.startsWith('http')) {
      console.log(`[getStream] Detected direct URL. Proxying...`);
      finalStreamUrl = file;
    } else {
      // Old token logic with mirror support
      const urlObj = new URL(file.includes('http') ? file : `http://localhost?file=${file}`);
      const proxyRef = urlObj.searchParams.get('proxy_ref');
      const token = urlObj.searchParams.get('file') || file;

      const baseDomain = proxyRef ? proxyRef.replace(/\/$/, '') : (await getPlayerUrl()).replace(/\/$/, '');
      const path = token.startsWith('~') ? token.slice(1) + ".txt" : token + ".txt";
      const playlistUrl = `${baseDomain}/playlist/${path}`;

      console.log(`[getStream] Fetching token from: ${playlistUrl}`);
      const response = await axios.get(playlistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Referer": baseDomain + "/",
          "X-Csrf-Token": key
        },
        httpAgent: torAgent,
        httpsAgent: torAgent,
        timeout: 15000,
      });
      finalStreamUrl = response.data;
    }

    // 2. Wrap the final link in our CORS Proxy
    const host = req.get('host');
    const proxiedLink = `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}`;

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
