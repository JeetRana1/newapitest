import axios from "axios";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from './cache';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
};

export default async function getInfo(id: string) {
  // Check cache first
  const cachedResult = cache.get(`getInfo_${id}`);
  if (cachedResult) {
    console.log(`[getInfo] Returning cached result for ID: ${id}`);
    return cachedResult;
  }

  try {
    const playerUrl = await getPlayerUrl();

    // 1. Curated High-Reliability Mirror List (Gold Standard Only)
    const domains = [
      "https://allmovieland.link/",
      "https://vekna402las.com",    // Primary - Very Stable
      playerUrl // Dynamic Fallback
    ];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://google.com/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    };

    // 2. Intelligence: Detect if it's a TV show ID or Missing Season/Ep
    const isExplicitTV = id.includes('-');

    // Retry mechanism for each domain
    for (let currentDomain of domains) {
      if (!currentDomain) continue;
      currentDomain = currentDomain.replace(/\/$/, '');

      // 3. Generate Smart Paths (expanded to cover more site variations)
      let paths = [
        `/play/${id}`,
        `/v/${id}`,
        `/movie/${id}`,
        `/watch/${id}`,
        `/embed/${id}`,
        `/e/${id}`,
        `/embed/movie/${id}`,
        `/watch/${id}/play`,
        `/play/${id}?autoplay=1`,
        `/movie/${id}/watch`
      ];

      // If it looks like a series ID without season/ep, try to brute-force Season 1 Episode 1
      if (!isExplicitTV && (currentDomain.includes('vidsrc') || currentDomain.includes('superembed') || currentDomain.includes('vekna') || currentDomain.includes('allmovieland'))) {
        paths.unshift(`/embed/tv/${id}/1/1`);
        paths.push(`/play/${id}-1-1`);
        paths.push(`/watch/${id}-s1-e1`);
      }

      if (isExplicitTV) {
        const parts = id.split('-');
        if (parts.length === 3) {
          paths.unshift(`/embed/tv/${parts[0]}/${parts[1]}/${parts[2]}`);
          paths.unshift(`/v/${parts[0]}/${parts[1]}/${parts[2]}`);
          paths.unshift(`/watch/${parts[0]}/${parts[1]}/${parts[2]}`);
          paths.push(`/play/${parts[0]}-${parts[1]}-${parts[2]}`);
        }
      } else {
        // Ensure embed/movie is tried early
        if (!paths.includes(`/embed/movie/${id}`)) paths.unshift(`/embed/movie/${id}`);
        if (!paths.includes(`/embed/${id}`)) paths.unshift(`/embed/${id}`);
      }

      // Retry mechanism for each path
      for (const path of paths) {
        const targetUrl = `${currentDomain}${path}`;
        
        // Multiple attempts for each path to improve reliability
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[getInfo] Scanning: ${targetUrl} (Attempt ${attempt})`);

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

            const extractFromText = (text: string) => {
              // Broad regexes to capture many site variants (attributes, JS, JWPlayer setups, data-* attrs)
              const regexes: RegExp[] = [
                /["']?(?:file|link|source|url|src|data-file|data-src|data-url)["']?\s*[:=]\s*["']([^"']+\.(?:txt|m3u8|json|php|js)[^"']*)["']/i,
                /<source[^>]+src=["']([^"']+\.(?:m3u8|mp4|txt|json|php|js))["']/i,
                /href=["']([^"']+\.(?:m3u8|txt|json|php|js))["']/i,
                /jwplayer\([^)]*\)\.setup\(\s*{[^}]*file\s*:\s*["']([^"']+)["']/i,
                /data-(?:file|src|url)=["']([^"']+)["']/i,
                /['"]?(?:playlist|sources)['"]?\s*[:=]\s*(\[[^\]]+\])/i
              ];

              for (const r of regexes) {
                const m = text.match(r);
                if (m && m[1]) return m[1];
              }
              return null;
            };

            // Try HTML first
            file = extractFromText(html);

            // CSRF/key detection (expand to meta tags and JS variables)
            const keyMatch = html.match(/["']?(?:key|token|csrf|hash|auth)["']?\s*[:=]\s*["']([^"']+)["']/i) || html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
            key = keyMatch ? keyMatch[1] : "NOT_REQUIRED";

            // If file points to a JS file, fetch it and try extracting again
            if (file && file.endsWith('.js')) {
              try {
                const jsUrl = file.startsWith('http') ? file : `${currentDomain}${file}`;
                const jsResp = await axios.get(jsUrl, { headers: { ...headers, "Referer": targetUrl }, httpAgent: torAgent, httpsAgent: torAgent, timeout: 15000 });
                const jsBody = typeof jsResp.data === 'string' ? jsResp.data : JSON.stringify(jsResp.data);
                const fromJs = extractFromText(jsBody);
                if (fromJs) {
                  file = fromJs;
                } else {
                  // keep original JS if nothing found inside
                }
              } catch (e: unknown) {
                console.log(`[getInfo] Failed to fetch/parse JS candidate ${file}: ${getErrorMessage(e)}`);
              }
            }

            if (file) {
              file = file.replace(/\\\//g, "/");
              const playlistUrl = file.startsWith("http") ? file : `${currentDomain}${file}`;

              console.log(`[getInfo] Candidate Found! File: ${file.substring(0, 120)}...`);

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
                  const verifyRes = await axios.head(playlistUrl, {
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
                  } else {
                    // For other errors (like 405 Method Not Allowed for HEAD), continue anyway
                    console.log(`[getInfo] Mirror ${currentDomain} found a link, HEAD verification failed (${e.message}), but continuing...`);
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

                  const result = { success: true, data: { playlist: optimizedPlaylist, key } };
                  
                  // Cache the successful result for 30 minutes
                  cache.set(`getInfo_${id}`, result, 30 * 60 * 1000);
                  
                  return result;
                }
              } catch (playlistErr: any) {
                // Silence playlist 404s, keep searching
                console.log(`[getInfo] Playlist error for ${playlistUrl}: ${playlistErr.message}`);
              }
            }
          } catch (e: any) {
            // Log the error but continue to next attempt
            console.log(`[getInfo] Attempt ${attempt} failed for ${targetUrl}: ${e.message}`);
            
            // If this was the last attempt for this path, continue to next path
            if (attempt >= 3) {
              console.log(`[getInfo] All attempts failed for ${targetUrl}. Moving to next path.`);
            }
          }
        }
      }
    }

    const result = {
      success: false,
      message: "Media not found on any mirror. Try providing ID in tt1234567-S-E format for TV shows."
    };
    
    // Cache the failure result for 5 minutes to prevent repeated requests
    cache.set(`getInfo_${id}`, result, 5 * 60 * 1000);
    
    return result;

  } catch (error: any) {
    const result = { success: false, message: `Scraper error: ${error.message}` };
    
    // Cache the error result for 5 minutes to prevent repeated requests
    cache.set(`getInfo_${id}`, result, 5 * 60 * 1000);
    
    return result;
  }
}