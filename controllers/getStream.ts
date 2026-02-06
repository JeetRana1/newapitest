import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }
  const f = file as string;
  const path = f.slice(1) + ".txt";
  try {
    const playerUrl = await getPlayerUrl();
    // const origin = new URL(playerUrl).origin;
    const playlistUrl = `${playerUrl}/playlist/${path}`;
    console.log('Fetching playlist URL:', playlistUrl);
    // fetch playlist with a timeout so the request fails fast if remote host is unresponsive
    const linkRes = await axios.get(playlistUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://allmovieland.link/", // Some streams require this specific referer
        "Origin": "https://allmovieland.link",
        "X-Csrf-Token": key
      },
      timeout: 10000,
    });
    console.log('Playlist response status:', linkRes.status);
    console.log('Playlist response data (truncated):', String(linkRes.data).slice(0, 200));
    res.json({
      success: true,
      data: {
        link: linkRes.data,
      },
    });
  } catch (err) {
    console.log("error: ", err);
    res.json({
      success: false,
      message: "No media found",
    });
  }
}
