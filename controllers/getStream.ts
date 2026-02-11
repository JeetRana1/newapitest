import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torProxyUrl = (process.env.TOR_PROXY_URL || "").trim();
const torAgent = torProxyUrl ? new SocksProxyAgent(torProxyUrl) : null;

async function getWithOptionalTor(url: string, config: any) {
  if (!torAgent) {
    return axios.get(url, config);
  }

  try {
    return await axios.get(url, {
      ...config,
      httpAgent: torAgent,
      httpsAgent: torAgent,
    });
  } catch (err: any) {
    const message = String(err?.message || "");
    if (err?.code === "ECONNREFUSED" || message.includes("127.0.0.1:9050")) {
      console.log("[getStream] Tor unavailable. Falling back to direct request.");
      return axios.get(url, config);
    }
    throw err;
  }
}

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;

  if (!file || !key) {
    return res.status(400).json({ success: false, message: "Missing file or key" });
  }

  try {
    let finalStreamUrl = "";
    let token = decodeURIComponent(file);
    let proxyRef = "";

    // Support for proxy_ref hint in token
    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");
    }

    if (token.startsWith('http')) {
      finalStreamUrl = token;
    } else {
      // New logic: fetch token from mirror
      const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');
      const path = token.startsWith('~') ? token.slice(1) : token;
      const playlistUrl = `${baseDomain}/playlist/${path}.txt`;

      console.log(`[getStream] Mirroring from: ${baseDomain}`);
      const response = await getWithOptionalTor(playlistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Referer": baseDomain + "/",
          "X-Csrf-Token": key
        },
        timeout: 15000,
      });

      finalStreamUrl = response.data;
    }

    if (!finalStreamUrl || typeof finalStreamUrl !== 'string' || !finalStreamUrl.startsWith('http')) {
      return res.status(500).json({ success: false, message: "Invalid stream URL received from mirror" });
    }

    // Wrap in Proxy
    const host = req.get('host');
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
    const proxiedLink = `${protocol}://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;

    res.json({
      success: true,
      data: {
        link: proxiedLink
      }
    });

  } catch (err: any) {
    console.error(`[getStream] Error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}
