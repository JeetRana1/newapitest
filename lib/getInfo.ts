import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const targetUrl = `${playerUrl}/play/${id}`;

    console.log(`Attempting to fetch from: ${targetUrl}`);
    console.log(`Player URL resolved to: ${playerUrl}`);

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
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      console.log(`Response status: ${response.status} for URL: ${targetUrl}`);
    } catch (e: any) {
      console.log(`Error making request to ${targetUrl}:`, e.message);
      console.log(`Error response status:`, e.response?.status);

      // Retry with different headers
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
        console.log(`Retry also failed, trying fallback...`);
        // Try fallback domain
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
          throw new Error(`All attempts to fetch data failed. Error: ${e.message}, Retry error: ${retryError.message}, Fallback error: ${fallbackError.message}`);
        }
      }
    }

    const $ = cheerio.load(response.data);

    console.log("Looking for data in page...");
    console.log("Number of script tags found:", $("script").length);

    // Simple approach: look for any script containing 'file' and 'key'
    let scriptContent = null;
    let matchedContent = null;
    
    // Get all script elements
    const scriptElements = $("script");
    
    // Loop through each script element
    for (let i = 0; i < scriptElements.length; i++) {
      const element = scriptElements[i];
      const scriptText = $(element).html();
      
      if (scriptText && scriptText.includes('file') && scriptText.includes('key')) {
        // Look for JSON objects in the script
        const jsonRegex = /\{[^{}]*file[^{}]*key[^{}]*\}|\{[^{}]*key[^{}]*file[^{}]*\}/g;
        let match;
        
        while ((match = jsonRegex.exec(scriptText)) !== null) {
          const potentialObject = match[0];
          try {
            const parsed = JSON.parse(potentialObject);
            if (parsed.file && parsed.key) {
              matchedContent = potentialObject;
              scriptContent = scriptText;
              console.log(`Found valid data in script ${i}:`, potentialObject.substring(0, 100) + '...');
              break;
            }
          } catch (e) {
            // Not valid JSON, continue searching
            continue;
          }
        }
        
        if (matchedContent) break; // Found what we need
      }
    }

    // If still not found, try a broader search
    if (!matchedContent) {
      for (let i = 0; i < scriptElements.length; i++) {
        const element = scriptElements[i];
        const scriptText = $(element).html();
        
        if (scriptText) {
          // Look for any JSON object that might contain the data
          const jsonRegex = /\{[^{}]*["'](?:file|key)["'][^{}]*\}/g;
          let match;
          
          while ((match = jsonRegex.exec(scriptText)) !== null) {
            const potentialObject = match[0];
            try {
              const parsed = JSON.parse(potentialObject);
              if (parsed.file !== undefined || parsed.key !== undefined) {
                matchedContent = potentialObject;
                scriptContent = scriptText;
                console.log(`Found potential data in script ${i}:`, potentialObject.substring(0, 100) + '...');
                break;
              }
            } catch (e) {
              // Not valid JSON, continue searching
              continue;
            }
          }
          
          if (matchedContent) break; // Found what we need
        }
      }
    }

    if (!scriptContent || !matchedContent) {
      console.log("Scripts on page:");
      for (let i = 0; i < Math.min(5, scriptElements.length); i++) {
        const element = scriptElements[i];
        const scriptText = $(element).html();
        if (scriptText && scriptText.length > 0) {
          console.log(`Script ${i}:`, `"${scriptText.substring(0, 300)}${scriptText.length > 300 ? '...' : ''}"`);
        }
      }
      return { success: false, message: "Could not find stream data script on page." };
    }

    let data;
    try {
      data = JSON.parse(matchedContent);
    } catch (parseError) {
      console.error("Failed to parse JSON:", matchedContent);
      return { success: false, message: `Failed to parse stream data: ${(parseError as Error).message}` };
    }

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
    return {
      success: false,
      message: `API Error at ${errorUrl}: ${error?.message || "Something went wrong"}`,
    };
  }
}