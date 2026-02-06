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

    const html = response.data;
    console.log("HTML length:", html.length);
    
    // Log the first 1000 characters of the HTML to see what we're working with
    console.log("HTML start:", html.substring(0, 1000));
    
    // Also log the end of the HTML
    console.log("HTML end:", html.substring(Math.max(0, html.length - 1000)));
    
    const $ = cheerio.load(html);

    console.log("Looking for data in page...");
    console.log("Number of script tags found:", $("script").length);

    // Let's examine ALL scripts to see what's there
    const scripts = $("script");
    console.log("Examining all script tags:");
    
    for (let i = 0; i < scripts.length; i++) {
      const element = scripts[i];
      const scriptText = $(element).html();
      
      if (scriptText) {
        console.log(`Script ${i} (${scriptText.length} chars): "${scriptText.substring(0, 200)}${scriptText.length > 200 ? '...' : ''}"`);
        
        // Look for any JSON-like structures in any script
        const jsonPattern = /\{[^{}]*\}/g;
        let match;
        while ((match = jsonPattern.exec(scriptText)) !== null) {
          try {
            const obj = JSON.parse(match[0]);
            console.log(`Found JSON object in script ${i}:`, obj);
            
            // Check if this object has the properties we need
            if (obj.file || obj.key || obj.sources || obj.playlist) {
              console.log(`Found relevant data in script ${i}:`, match[0]);
              
              const file = obj.file;
              const key = obj.key;

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
            }
          } catch (e) {
            // Not valid JSON, continue
            continue;
          }
        }
      }
    }

    // If we still haven't found it, let's try a different approach
    // Maybe the data is stored differently now
    console.log("Trying alternative search methods...");
    
    // Look for inline JSON in the HTML that might not be in script tags
    const inlineJsonPattern = /(\{[^{}]*file[^{}]*key[^{}]*\}|\{[^{}]*key[^{}]*file[^{}]*\})/g;
    let inlineMatch;
    while ((inlineMatch = inlineJsonPattern.exec(html)) !== null) {
      try {
        const obj = JSON.parse(inlineMatch[0]);
        if (obj.file && obj.key) {
          console.log("Found inline JSON data:", obj);
          
          const file = obj.file;
          const key = obj.key;

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
        }
      } catch (e) {
        continue;
      }
    }

    return { success: false, message: "Could not find stream data script on page. Detailed logs provided." };
  } catch (error: any) {
    const errorUrl = error.config?.url || 'unknown url';
    console.error(`Error in getInfo at ${errorUrl}:`, error?.message || error);
    return {
      success: false,
      message: `API Error at ${errorUrl}: ${error?.message || "Something went wrong"}`,
    };
  }
}