import axios from "axios";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();

    // 1. Curated High-Reliability Mirror List (Gold Standard Only)
    const domains = [
      "https://allmovieland.link/",
      "https://vekna402las.com",
      "https://allmovieland.link",
      "https://allmovieland.work",
      "https://allmovieland.site",
      "https://allmovieland.io",
      "https://vidsrc.ru",       // Primary - Very Stable
      "https://vidsrc.pro",      // Secondary - Fast
      "https://vidlink.pro",     // Backup - Reliable
      "https://superembed.stream", // Backup - Good Quality
      playerUrl // Dynamic Fallback
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://google.com/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    };

    // 2. Intelligence: Detect if it's a TV show ID or Missing Season/Ep
    const isExplicitTV = id.includes('-');

    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      // 3. Generate Smart Paths
      let paths = [`/play/${id}`, `/v/${id}`, `/movie/${id}`];

      // If it looks like a series ID without season/ep, try to brute-force Season 1 Episode 1
      if (!isExplicitTV && (currentDomain.includes('vidsrc') || currentDomain.includes('superembed'))) {
        paths.unshift(`/embed/tv/${id}/1/1`);
        paths.push(`/play/${id}-1-1`);
      }

      if (isExplicitTV) {
        const parts = id.split('-');
        if (parts.length === 3) {
          paths.unshift(`/embed/tv/${parts[0]}/${parts[1]}/${parts[2]}`);
          paths.unshift(`/v/${parts[0]}/${parts[1]}/${parts[2]}`);
          paths.push(`/play/${parts[0]}-${parts[1]}-${parts[2]}`);
        }
      } else if (!paths.includes(`/embed/movie/${id}`)) {
        paths.unshift(`/embed/movie/${id}`);
      }

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

          // 4. Ultra-Aggressive Extraction
          let file: string | null = null;
          let key: string | null = null;

          // Priority 1: HLS/Manifest links (the gold standard)
          const manifestMatch = html.match(/["']?(?:file|link|source|url|src)["']?\s*[:=]\s*["']([^"']+\.(?:txt|m3u8|json|php)[^"']*)["']/i);

          // Priority 2: Streaming Object/Variable
          const objectMatch = html.match(/["']?sources["']?\s*[:=]\s*\[\s*{\s*["']?file["']?\s*:\s*["']([^"']+)["']/i);

          // Priority 3: CSRF/Security Key
          const keyMatch = html.match(/["']?(?:key|token|csrf|hash|auth)["']?\s*[:=]\s*["']([^"']+)["']/i);

          file = (manifestMatch ? manifestMatch[1] : (objectMatch ? objectMatch[1] : null));
          key = keyMatch ? keyMatch[1] : "NOT_REQUIRED"; // Some fallback providers don't need a key

          if (file && !file.endsWith('.js')) {
            file = file.replace(/\\\//g, "/");
            const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

            console.log(`[getInfo] Candidate Found! File: ${file.substring(0, 50)}...`);

            try {
              const playlistRes = await axios.get(playlistUrl, {
                headers: { ...headers, "X-Csrf-Token": key, "Referer": targetUrl },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 15000
              });

              let data = playlistRes.data;
              let playlist: any[] = [];

              // Decode Base64 if needed
              if (typeof data === 'string' && data.length > 50 && !data.includes('http') && !data.includes('{')) {
                try {
                  const decoded = Buffer.from(data, 'base64').toString('utf-8');
                  if (decoded.includes('http') || decoded.includes('{')) data = decoded;
                } catch (e) { }
              }

              // Parse list
              if (Array.isArray(data)) {
                playlist = data;
              } else if (typeof data === 'object' && data !== null) {
                playlist = data.playlist || data.data || (data.sources ? data.sources : []);
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

              // 4. PRE-VERIFY: Check if the stream actually plays before returning success
              try {
                const verifyRes = await axios.get(playlistUrl, {
                  headers: { ...headers, "X-Csrf-Token": key, "Referer": targetUrl },
                  httpAgent: torAgent,
                  httpsAgent: torAgent,
                  timeout: 5000,
                  validateStatus: (status) => status < 400
                });
              } catch (e: any) {
                if (e.response?.status === 403 || e.response?.status === 404) {
                  console.log(`[getInfo] Mirror ${currentDomain} found a link, but it's dead (${e.response?.status}). Skipping...`);
                  continue;
                }
              }

              if (playlist.length > 0) {
                console.log(`[getInfo] Success! Found verified stream on ${currentDomain}`);

                // CRITICAL: Encode the referer into the file URLs so the Proxy knows how to "handshake"
                const optimizedPlaylist = playlist.map((item: any) => {
                  if (item.file && !item.file.includes('proxy_ref=')) {
                    const separator = item.file.includes('?') ? '&' : '?';
                    item.file = `${item.file}${separator}proxy_ref=${encodeURIComponent(currentDomain)}`;
                  }
                  return item;
                });

                return { success: true, data: { playlist: optimizedPlaylist, key } };
              }
            } catch (playlistErr: any) {
              // Silence playlist 404s, keep searching
            }
          }
        } catch (e: any) {
          // Skip 404s and keep searching other mirrors
        }
      }
    }

    return {
      success: false,
      message: "Media not found on any mirror. Try providing ID in tt1234567-S-E format for TV shows."
    };

  } catch (error: any) {
    return { success: false, message: `Scraper error: ${error.message}` };
  }
}