import axios from "axios";

export async function getPlayerUrl() {
  let baseUrl = (process.env.BASE_URL || 'https://allmovieland.link/player.js').trim();

  console.log(`Raw BASE_URL from env: ${baseUrl}`);

  // Decode URL-encoded characters
  try {
    baseUrl = decodeURIComponent(baseUrl);
  } catch (e) {
    console.log('Failed to decode BASE_URL, using as-is');
  }

  console.log(`Decoded BASE_URL: ${baseUrl}`);

  const tryFetch = async (url: string) => {
    try {
      console.log(`Trying to fetch player URL from: ${url}`);
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': 'https://google.com'
        },
        timeout: 10000
      });
      const resText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const playerUrlMatch = resText.match(/const AwsIndStreamDomain\s*=\s*'([^']+)'/);

      if (playerUrlMatch && playerUrlMatch[1]) {
        const domain = playerUrlMatch[1];
        console.log(`Found player domain: ${domain}`);
        // Validate domain format and ensure it's not a known dead one
        if (domain.startsWith('http') && !domain.includes('protection-episode-i-222.site')) {
          return domain.endsWith('/') ? domain.slice(0, -1) : domain;
        }
      }
      console.log(`No valid player URL found in response from ${url}`);
      return null;
    } catch (e: any) {
      console.log(`Failed to fetch from ${url}: ${e.message}`);
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

  // 5. Hardcoded fallback (as a last resort if all scraping fails)
  if (!playerUrl) {
    console.log('All player URL fetch attempts failed, using hardcoded fallback');
    playerUrl = 'https://vekna402las.com';
  }

  console.log(`Final Resolved Player URL: ${playerUrl}`);
  return playerUrl;
}
