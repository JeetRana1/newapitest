import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;
    
    console.log(`Attempting to fetch from: ${targetUrl}`);
    console.log(`Player URL resolved to: ${playerUrl}`);

    // We'll try to find which Referer works. The player domain seems picky.
    // Try https://allmovieland.link/ first, then google.com as fallback
    let response;
    try {
      response = await axios.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://allmovieland.link/",
          "Origin": "https://allmovieland.link",
          "Cache-Control": "max-age=0"
        },
        timeout: 15000, // Increased timeout for Vercel
        validateStatus: (status) => status < 500 // Accept 4xx and 5xx as valid for error handling
      });
      
      console.log(`Response status: ${response.status} for URL: ${targetUrl}`);
    } catch (e: any) {
      console.log(`Error making request to ${targetUrl}:`, e.message);
      console.log(`Error response status:`, e.response?.status);
      console.log(`Error response data:`, e.response?.data);
      
      if (e.response?.status === 404 || e.response?.status === 403 || e.response?.status === 500) {
        // Retry with a different common referer
        console.log("Retrying with different headers...");
        try {
          response = await axios.get(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": "https://www.google.com/",
              "Origin": "https://www.google.com/"
            },
            timeout: 15000
          });
          
          console.log(`Retry response status: ${response.status} for URL: ${targetUrl}`);
        } catch (retryError: any) {
          console.log(`Retry also failed with status:`, retryError.response?.status);
          // If both attempts fail, try the hardcoded fallback domain
          const fallbackUrl = `https://vekna402las.com/play/${id}`;
          console.log(`Trying fallback URL: ${fallbackUrl}`);
          
          try {
            response = await axios.get(fallbackUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://allmovieland.link/",
                "Origin": "https://allmovieland.link/"
              },
              timeout: 15000
            });
            
            console.log(`Fallback response status: ${response.status} for URL: ${fallbackUrl}`);
          } catch (fallbackError: any) {
            console.log(`Fallback also failed with status:`, fallbackError.response?.status);
            throw new Error(`All attempts to fetch data failed. Original error: ${e.message}, Retry error: ${retryError.message}, Fallback error: ${fallbackError.message}`);
          }
        }
      } else {
        throw e;
      }
    }

    const $ = cheerio.load(response.data);
    
    // Look for scripts that contain the data we need
    let scriptContent = null;
    let matchedContent = null;
    
    // First, try to find the script with the specific pattern
    $('script').each((index, element) => {
      const scriptText = $(element).html();
      if (scriptText && (scriptText.includes('file') || scriptText.includes('key'))) {
        // Look for the specific pattern that contains the data
        const content = scriptText.match(/(\{[^;]*file[^}]*key[^}]*\});/) || 
                       scriptText.match(/(\{[^;]*key[^}]*file[^}]*\});/) ||
                       scriptText.match(/\((\{.*file.*key.*\})\)/) ||
                       scriptText.match(/\((\{.*key.*file.*\})\)/) ||
                       scriptText.match(/(\{[^}]*"file"[^}]*"key"[^}]*\});/) ||
                       scriptText.match(/(\{[^}]*"key"[^}]*"file"[^}]*\});/);
        
        if (content && content[1]) {
          matchedContent = content[1].trim().replace(/[;)]+$/, '');
          scriptContent = scriptText;
          return false; // break the loop
        }
      }
    });

    // If we didn't find it with the specific search, try the last script anyway
    if (!matchedContent) {
      const lastScript = $("script").last().html();
      if (lastScript) {
        const content = lastScript.match(/(\{[^;]+});/)?.[1] || lastScript.match(/\((\{.*\})\)/)?.[1];
        if (content) {
          matchedContent = content;
          scriptContent = lastScript;
        }
      }
    }

    if (!scriptContent || !matchedContent) {
      console.log("Available scripts on the page:");
      $('script').each((index, element) => {
        const scriptText = $(element).html();
        if (scriptText && scriptText.length > 0) {
          console.log(`Script ${index}:`, scriptText.substring(0, 200) + (scriptText.length > 200 ? '...' : ''));
        }
      });
      return { success: false, message: "Could not find stream data script on page. Available scripts logged to console." };
    }

    const data = JSON.parse(matchedContent);
    const file = data["file"];
    const key = data["key"];

    // Ensure the link is absolute
    const link = file?.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

    console.log(`Fetching playlist from: ${link}`);
    
    const playlistRes = await axios.get(link, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": targetUrl,
        "X-Csrf-Token": key
      },
      timeout: 15000
    });

    const playlist = Array.isArray(playlistRes.data)
      ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
      : [];

    return {
      success: true,
      data: {
        playlist,
        key,
      },
    };
  } catch (error: any) {
    const errorUrl = error.config?.url || 'unknown url';
    console.error(`Error in getInfo at ${errorUrl}:`, error?.message || error);
    console.error(`Full error object:`, error);
    return {
      success: false,
      message: `API Error at ${errorUrl}: ${error?.message || "Something went wrong"}`,
    };
  }
}
