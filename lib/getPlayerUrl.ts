import axios from "axios";

export async function getPlayerUrl() {
  let baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("BASE_URL environment variable is not set");
  }

  // Handle potential Vercel double-encoding or special character issues
  // If the user pasted with spaces or %20, let's normalize it
  baseUrl = baseUrl.replace(/%2520/g, " ").replace(/%20/g, " ");

  const tryFetch = async (url: string) => {
    try {
      console.log(`Attempting to fetch player domain from: ${url}`);
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': new URL(url).origin
        },
        timeout: 8000
      });
      const resText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const playerUrlMatch = resText.match(/const AwsIndStreamDomain\s*=\s*'([^']+)'/);
      return playerUrlMatch ? playerUrlMatch[1] : null;
    } catch (e: any) {
      console.error(`Fetch failed for ${url}: ${e.message}`);
      return null;
    }
  };

  // Try the provided URL (normalized)
  let playerUrl = await tryFetch(baseUrl);

  // Fallback 1: If it has query params, try without them
  if (!playerUrl && baseUrl.includes('?')) {
    playerUrl = await tryFetch(baseUrl.split('?')[0]);
  }

  // Fallback 2: Try .io if .link is failing
  if (!playerUrl && baseUrl.includes('allmovieland.link')) {
    playerUrl = await tryFetch('https://allmovieland.io/player.js');
  }

  // Fallback 3: Try getting it from a known working movie page if possible
  // (Optional, but adding a common one as last resort)
  if (!playerUrl) {
    playerUrl = await tryFetch('https://allmovieland.io/8183-special-ops.html');
  }

  if (!playerUrl) {
    throw new Error(`Could not find player URL from any source. Check if the domains are blocked.`);
  }

  // Ensure no trailing slash for consistency in getInfo.ts
  const cleanUrl = playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl;
  console.log(`Found working player domain: ${cleanUrl}`);
  return cleanUrl;
}
