import axios from "axios";

export async function getPlayerUrl() {
  let baseUrl = (process.env.BASE_URL || 'https://allmovieland.link/player.js').trim();

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
        timeout: 15000 // Increased timeout for Vercel
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
          console.log(`Found player domain with pattern ${pattern}: ${domain} from URL: ${url}`);
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
      return null;
    }
  };

  // 1. Try provided BASE_URL
  let playerUrl = await tryFetch(baseUrl);

  // 2. Try .link without version
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.link/player.js');
  }

  // 3. Try .io movie page (very reliable as it's the main site)
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.io/8183-special-ops.html');
  }

  // 4. Try .io player.js directly
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.io/player.js');
  }

  // 5. Try alternative domains that might work better on Vercel
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.net/player.js');
  }
  
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.tv/player.js');
  }

  // 6. Try some other potential domains
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.cam/player.js');
  }
  
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.skin/player.js');
  }

  // 7. Hardcoded fallback (as a last resort if all scraping fails)
  if (!playerUrl) {
    playerUrl = 'https://vekna402las.com';
    console.log('Using hardcoded fallback URL');
  }

  console.log(`Final Resolved Player URL: ${playerUrl}`);
  return playerUrl;
}