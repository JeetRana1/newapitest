import axios from "axios";
import cache from "./cache";

const PLAYER_URL_CACHE_KEY = "resolved_player_url";
const PLAYER_URL_TTL_MS = 10 * 60 * 1000;
let inFlightResolve: Promise<string> | null = null;

export async function getPlayerUrl() {
  const cachedPlayerUrl = cache.get(PLAYER_URL_CACHE_KEY);
  if (cachedPlayerUrl) {
    return cachedPlayerUrl;
  }

  if (inFlightResolve) {
    return inFlightResolve;
  }

  inFlightResolve = (async () => {
  let baseUrl = (process.env.BASE_URL || 'https://allmovieland.link/player.js').trim();

  console.log(`Base URL: ${baseUrl}`);
  
  // Normalize spaces/encoding
  baseUrl = baseUrl.replace(/%2520/g, " ").replace(/%20/g, " ");

  const tryFetch = async (url: string) => {
    try {
      console.log(`Attempting to fetch from: ${url}`);
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://google.com',
          'Origin': 'https://google.com'
        },
        timeout: 8000
      });
      console.log(`Successfully fetched from: ${url}, status: ${res.status}`);
      
      const resText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      console.log(`Response length from ${url}: ${resText.length}`);
      
      // Look for multiple possible patterns
      const patterns = [
        /const\s+AwsIndStreamDomain\s*=\s*'([^']+)'/,
        /const\s+AwsIndStreamDomain\s*=\s*"([^"]+)"/,
        /var\s+AwsIndStreamDomain\s*=\s*'([^']+)'/,
        /var\s+AwsIndStreamDomain\s*=\s*"([^"]+)"/,
        /AwsIndStreamDomain\s*:\s*'([^']+)'/,
        /AwsIndStreamDomain\s*:\s*"([^"]+)"/,
        /['"]?AwsIndStreamDomain['"]?\s*[:=]\s*['"]([^'"]+)['"]/,
        /domain\s*[:=]\s*['"]([^'"]*\.com)['"]/,
        /['"]baseURL['"]\s*[:=]\s*['"]([^'"]+)['"]/,
        /['"]apiURL['"]\s*[:=]\s*['"]([^'"]+)['"]/,
        /['"]streamURL['"]\s*[:=]\s*['"]([^'"]+)['"]/,
      ];
      
      for (const pattern of patterns) {
        const playerUrlMatch = resText.match(pattern);
        if (playerUrlMatch && playerUrlMatch[1]) {
          const domain = playerUrlMatch[1];
          console.log(`Found player domain with pattern: ${pattern.toString()} - ${domain} from URL: ${url}`);
          // Validate domain format and ensure it's not a known dead one
          if (domain.startsWith('http') && !domain.includes('protection-episode-i-222.site')) {
            return domain.endsWith('/') ? domain.slice(0, -1) : domain;
          } else if (!domain.startsWith('http')) {
            // If it doesn't start with http, prepend https
            const fullDomain = `https://${domain}`;
            if (!fullDomain.includes('protection-episode-i-222.site')) {
              return fullDomain.endsWith('/') ? fullDomain.slice(0, -1) : fullDomain;
            }
          }
        }
      }
      
      console.log(`No player domain found with any pattern in response from: ${url}`);
      // Log a snippet of the response for debugging
      console.log(`Response snippet: ${resText.substring(0, 500)}...`);
      return null;
    } catch (e: any) {
      console.log(`Failed to fetch from: ${url}`, e.message);
      console.log(`Error details:`, e.code, e.response?.status, e.response?.statusText);
      return null;
    }
  };

  // 1. Try provided BASE_URL
  let playerUrl = await tryFetch(baseUrl);
  console.log(`Step 1 - Base URL result: ${playerUrl}`);

  // 2. Try .link without version
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.link/player.js');
    console.log(`Step 2 - Link result: ${playerUrl}`);
  }

  // 3. Try .io movie page (very reliable as it's the main site)
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.io/8183-special-ops.html');
    console.log(`Step 3 - IO movie page result: ${playerUrl}`);
  }

  // 4. Try .io player.js directly
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.io/player.js');
    console.log(`Step 4 - IO player.js result: ${playerUrl}`);
  }

  // 5. Try alternative domains that might work better on Vercel
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.net/player.js');
    console.log(`Step 5 - Net result: ${playerUrl}`);
  }
  
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.tv/player.js');
    console.log(`Step 6 - TV result: ${playerUrl}`);
  }

  // 6. Try some other potential domains
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.cam/player.js');
    console.log(`Step 7 - CAM result: ${playerUrl}`);
  }
  
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.skin/player.js');
    console.log(`Step 8 - Skin result: ${playerUrl}`);
  }

  // 7. Hardcoded fallback (as a last resort if all scraping fails)
  if (!playerUrl) {
    playerUrl = 'https://vekna402las.com';
    console.log('Using hardcoded fallback URL');
  }

  console.log(`Final Resolved Player URL: ${playerUrl}`);
  cache.set(PLAYER_URL_CACHE_KEY, playerUrl, PLAYER_URL_TTL_MS);
  return playerUrl;
  })();

  try {
    return await inFlightResolve;
  } finally {
    inFlightResolve = null;
  }
}
