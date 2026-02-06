import axios from "axios";
import { Request, Response } from "express";

export default async function proxy(req: Request, res: Response) {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
        return res.status(400).send("No URL provided");
    }

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://allmovieland.link/",
                "Origin": "https://allmovieland.link"
            },
            responseType: 'stream',
            timeout: 10000
        });

        // Set CORS headers to allow your website to read the data
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Content-Type", response.headers["content-type"] || "application/x-mpegURL");

        response.data.pipe(res);
    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message}`);
        res.status(500).send("Proxy failed to fetch the stream.");
    }
}
