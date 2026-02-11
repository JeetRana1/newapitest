import axios from "axios";

let cachedPlayerUrl: string | null = null;
let cachedAt = 0;
let inflight: Promise<string> | null = null;
const PLAYER_URL_TTL_MS = 10 * 60 * 1000;

export async function getPlayerUrl() {
  const now = Date.now();
  if (cachedPlayerUrl && now - cachedAt < PLAYER_URL_TTL_MS) {
    return cachedPlayerUrl;
  }

  if (inflight) {
    return inflight;
  }

  inflight = resolvePlayerUrl();
  try {
    const resolved = await inflight;
    cachedPlayerUrl = resolved;
    cachedAt = Date.now();
    return resolved;
  } finally {
    inflight = null;
  }
}

async function resolvePlayerUrl() {
  let baseUrl = (process.env.BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("BASE_URL is not configured");
  }

  console.log(`Base URL: ${baseUrl}`);

  // Normalize spaces/encoding
  baseUrl = baseUrl.replace(/%2520/g, " ").replace(/%20/g, " ");
  const baseOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  })();

  const scraperReferer =
    (process.env.SCRAPER_REFERER || (baseOrigin ? `${baseOrigin}/` : "")).trim();
  const scraperOrigin =
    (process.env.SCRAPER_ORIGIN || scraperReferer.replace(/\/$/, "")).trim();
  const fallbackUrls = (process.env.PLAYER_FALLBACK_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const candidateUrls = [baseUrl, ...fallbackUrls.filter((url) => url !== baseUrl)];

  const tryFetch = async (url: string) => {
    try {
      console.log(`Attempting to fetch from: ${url}`);
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      };
      if (scraperReferer) headers["Referer"] = scraperReferer;
      if (scraperOrigin) headers["Origin"] = scraperOrigin;

      const res = await axios.get(url, {
        headers,
        timeout: 15000 // Increased timeout for Vercel
      });
      console.log(`Successfully fetched from: ${url}, status: ${res.status}`);

      const resText = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
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
          if (domain.startsWith("http") && !domain.includes("protection-episode-i-222.site")) {
            return domain.endsWith("/") ? domain.slice(0, -1) : domain;
          } else if (!domain.startsWith("http")) {
            // If it doesn't start with http, prepend https
            const fullDomain = `https://${domain}`;
            if (!fullDomain.includes("protection-episode-i-222.site")) {
              return fullDomain.endsWith("/") ? fullDomain.slice(0, -1) : fullDomain;
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

  let playerUrl: string | null = null;
  for (let i = 0; i < candidateUrls.length; i += 1) {
    playerUrl = await tryFetch(candidateUrls[i]);
    console.log(`Step ${i + 1} - Candidate result: ${playerUrl}`);
    if (playerUrl) break;
  }

  // Optional env fallback for emergency use.
  if (!playerUrl) {
    const envFallback = (process.env.PLAYER_HARDCODED_FALLBACK || "").trim();
    if (envFallback) {
      playerUrl = envFallback.endsWith("/") ? envFallback.slice(0, -1) : envFallback;
      console.log("Using env fallback URL");
    }
  }

  if (!playerUrl) {
    throw new Error("Unable to resolve player URL from BASE_URL / PLAYER_FALLBACK_URLS");
  }

  console.log(`Final Resolved Player URL: ${playerUrl}`);
  return playerUrl;
}
