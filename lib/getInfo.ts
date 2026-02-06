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
    
    // Log a larger sample of the HTML to see what we're working with
    console.log("HTML sample (first 2000 chars):", html.substring(0, 2000));
    
    // Check if the response is actually HTML or if it's something else
    if (typeof html !== 'string') {
      console.log("Response is not a string, it's:", typeof html);
      return { success: false, message: "Response is not in expected format" };
    }
    
    // Check if the response contains HTML indicators
    if (!html.toLowerCase().includes('<html') && !html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<script')) {
      console.log("Response doesn't appear to be HTML content");
      console.log("Actual response:", html.substring(0, 500));
      return { success: false, message: "Response doesn't contain expected HTML content" };
    }
    
    const $ = cheerio.load(html);

    console.log("Looking for data in page...");
    console.log("Number of script tags found:", $("script").length);

    // Let's see if there are any script tags at all
    const scripts = $("script");
    if (scripts.length === 0) {
      console.log("No script tags found in the page!");
      // Let's look for other possible containers
      console.log("Looking for other possible data containers...");
      
      // Check for any inline JSON in divs or other elements
      const allElements = $('*');
      for (let i = 0; i < allElements.length && i < 20; i++) { // Limit to first 20 elements
        const element = allElements[i];
        const elementHtml = $(element).html();
        const elementTag = $(element).prop('tagName');
        if (elementHtml && elementHtml.length > 0) {
          console.log(`Element ${i} [${elementTag}]: "${elementHtml.substring(0, 200)}${elementHtml.length > 200 ? '...' : ''}"`);
        }
      }
    }

    // Examine script tags specifically
    for (let i = 0; i < scripts.length; i++) {
      const element = scripts[i];
      const scriptText = $(element).html();
      
      if (scriptText) {
        console.log(`Script ${i} (${scriptText.length} chars): "${scriptText.substring(0, 300)}${scriptText.length > 300 ? '...' : ''}"`);
        
        // Look for any data that might be relevant
        if (scriptText.includes('file') || scriptText.includes('key') || scriptText.includes('source')) {
          console.log(`Script ${i} contains potential keywords! Full content:`, scriptText);
          
          // Try to extract JSON objects
          const jsonRegex = /(\{[^{}]*\})/g;
          let match;
          while ((match = jsonRegex.exec(scriptText)) !== null) {
            try {
              const obj = JSON.parse(match[1]);
              console.log(`Found JSON object in script ${i}:`, obj);
              
              // Check if this object has the properties we need
              if (obj.file !== undefined || obj.key !== undefined || obj.sources || obj.playlist) {
                console.log(`Found relevant data in script ${i}:`, obj);
                
                const file = obj.file;
                const key = obj.key;

                // Ensure the link is absolute
                const link = file?.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file || ''}`;

                console.log(`Fetching playlist from: ${link}`);

                const playlistRes = await axios.get(link, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Referer": targetUrl,
                    "X-Csrf-Token": key || ''
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
              console.log(`Could not parse JSON in script ${i}:`, match[1]);
              continue;
            }
          }
        }
      }
    }

    // If we still haven't found it, let's try a completely different approach
    // Maybe the data is in a different format now
    console.log("Trying to find data with alternative methods...");
    
    // Look for any JSON-like strings in the entire HTML
    const jsonDataRegex = /(["{].*?(?:file|key|source).*?["}])/g;
    let jsonDataMatch;
    while ((jsonDataMatch = jsonDataRegex.exec(html)) !== null) {
      console.log("Found potential JSON data:", jsonDataMatch[1]);
    }

    return { success: false, message: "Could not find stream data script on page. Check server logs for details." };
  } catch (error: any) {
    const errorUrl = error.config?.url || 'unknown url';
    console.error(`Error in getInfo at ${errorUrl}:`, error?.message || error);
    return {
      success: false,
      message: `API Error at ${errorUrl}: ${error?.message || "Something went wrong"}`,
    };
  }
}