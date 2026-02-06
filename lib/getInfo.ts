import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();

    const domains = [
      playerUrl,
      "https://vekna402las.com",
      "https://vekna402las.net",
      "https://allmovieland.io",
      "https://allmovieland.link",
      "https://allmovieland.work",
      "https://allmovieland.site",
      "https://allmovieland.tv",
      "https://allmovieland.net",
      "https://new1.moviesdrive.surf"
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://allmovieland.link/",
      "Origin": "https://allmovieland.link",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    };

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      const paths = [`/play/${id}`, `/v/${id}`, `/movie/${id}`, `/embed/${id}`];

      for (const path of paths) {
        const targetUrl = `${currentDomain}${path}`;
        try {
          console.log(`[getInfo] Scanning: ${targetUrl}`);

          const response = await axios.get(targetUrl, {
            headers,
            httpAgent: torAgent,
            httpsAgent: torAgent,
            timeout: 15000,
            validateStatus: (s) => s === 200
          });

          const html = response.data.toString();

          // IMPROVED EXTRACTION:
          // 1. Try to find the file/playlist path. Search for 'file' or 'link' but exclude .js files.
          // We look for patterns like file: "path" or link: "path"
          let file: string | null = null;
          let key: string | null = null;

          // Priority 1: Match 'file' or 'link' assignments (most reliable)
          const playlistMatch = html.match(/["']?(?:file|link|source)["']?\s*[:=]\s*["']([^"']+\.(?:txt|m3u8|json|php)[^"']*)["']/i);
          if (playlistMatch) {
            file = playlistMatch[1];
          } else {
            // Priority 2: Fallback to a broader match but try to avoid script tags
            const broadMatch = html.match(/["']?(?:file|link|source|url)["']?\s*[:=]\s*["']([^"']+)["']/i);
            if (broadMatch && !broadMatch[1].endsWith('.js')) {
              file = broadMatch[1];
            }
          }

          const keyMatch = html.match(/["']?(?:key|token|csrf)["']?\s*[:=]\s*["']([^"']+)["']/i);
          if (keyMatch) key = keyMatch[1];

          if (file && key) {
            file = file.replace(/\\\//g, "/");
            const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

            console.log(`[getInfo] Found data Candidate! File: ${file} on ${currentDomain}`);

            try {
              const playlistRes = await axios.get(playlistUrl, {
                headers: { ...headers, "X-Csrf-Token": key, "Referer": targetUrl },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 15000
              });

              let data = playlistRes.data;
              let playlist: any[] = [];

              // Handle base64 encoded strings
              if (typeof data === 'string' && data.length > 30 && !data.includes('http') && !data.includes('{')) {
                try {
                  const decoded = Buffer.from(data, 'base64').toString('utf-8');
                  if (decoded.includes('http') || decoded.includes('{') || decoded.startsWith('[')) data = decoded;
                } catch (e) { }
              }

              if (Array.isArray(data)) {
                playlist = data;
              } else if (typeof data === 'object' && data !== null) {
                playlist = data.playlist || data.data || [];
              } else if (typeof data === 'string') {
                const trimmed = data.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                  try {
                    const jsonData = JSON.parse(trimmed);
                    playlist = Array.isArray(jsonData) ? jsonData : (jsonData.playlist || jsonData.data || []);
                  } catch (e) { }
                }

                if (playlist.length === 0 && (trimmed.includes('http') || trimmed.includes('.m3u8'))) {
                  playlist = [{ file: trimmed, label: 'Auto' }];
                }
              }

              if (playlist.length > 0) {
                console.log(`[getInfo] Success! Found ${playlist.length} tracks on ${currentDomain}`);
                return { success: true, data: { playlist, key } };
              } else {
                console.log(`[getInfo] Playlist rejected (empty/invalid) from ${currentDomain}`);
              }
            } catch (playlistErr: any) {
              console.log(`[getInfo] Failed to load candidate playlist: ${playlistErr.message}`);
            }
          }
        } catch (e: any) {
          if (e.response?.status !== 404) {
            console.log(`[getInfo] Mirror connectivity issue: ${targetUrl} (${e.message})`);
          }
        }
      }
    }

    return {
      success: false,
      message: "Streaming provider is currently rotating domains or the IMDB ID is the wrong format for TV shows."
    };

  } catch (error: any) {
    return { success: false, message: `Fatal API Error: ${error.message}` };
  }
}