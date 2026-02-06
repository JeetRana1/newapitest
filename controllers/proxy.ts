import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';

// Use the same Tor bridge for the proxy
const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function proxy(req: Request, res: Response) {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
        return res.status(400).send("No URL provided");
    }

    try {
        console.log(`[Proxy] Routing stream via Tor: ${targetUrl.slice(0, 50)}...`);

        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://allmovieland.link/",
                "Origin": "https://allmovieland.link"
            },
            httpAgent: torAgent,
            httpsAgent: torAgent,
            responseType: 'stream',
            timeout: 20000,
            validateStatus: (status) => status < 500
        });

        if (response.status !== 200) {
            console.log(`[Proxy] Target returned ${response.status}. Stream might be dead or IP blocked.`);
            return res.status(response.status).send("Stream source error.");
        }

        // Pass headers to the browser
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", response.headers["content-type"] || "application/x-mpegURL");

        response.data.pipe(res);
    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message}`);
        res.status(500).send("Proxy Bridge Error.");
    }
}
