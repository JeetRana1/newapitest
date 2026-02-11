import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./lib/getPlayerUrl";
import dotenv from "dotenv";

dotenv.config();

async function debugGetInfo(id: string) {
  try {
    console.log("Starting debug for ID:", id);
    
    const playerUrl = await getPlayerUrl();
    console.log("Resolved player URL:", playerUrl);
    
    const targetUrl = `${playerUrl}/play/${id}`;
    console.log("Target URL:", targetUrl);
    const referer =
      (process.env.DEBUG_REFERER || (() => {
        try {
          return `${new URL(playerUrl).origin}/`;
        } catch {
          return "";
        }
      })()).trim();
    const origin = referer.replace(/\/$/, "");

    const response = await axios.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer,
        "Origin": origin,
        "Cache-Control": "max-age=0"
      },
      timeout: 15000
    });
    
    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers);
    
    const html = response.data;
    console.log("HTML length:", html.length);
    
    const $ = cheerio.load(html);
    
    console.log("Number of script tags found:", $("script").length);
    
    // Print out all script tags for debugging
    $("script").each((index, element) => {
      const scriptContent = $(element).html();
      if (scriptContent && scriptContent.trim()) {
        console.log(`Script ${index} content preview:`, scriptContent.substring(0, 300) + (scriptContent.length > 300 ? '...' : ''));
      }
    });
    
    // Look for the specific script that contains the data
    let scriptContent = null;
    let matchedContent = null;
    
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
          console.log(`Found matching content in script ${index}:`, matchedContent);
          return false; // break the loop
        }
      }
    });

    if (!matchedContent) {
      console.log("No matching content found in any script tag");
    } else {
      console.log("Successfully found content:", matchedContent);
      try {
        const data = JSON.parse(matchedContent);
        console.log("Parsed data:", data);
      } catch (parseError) {
        console.error("Error parsing JSON:", parseError);
      }
    }
  } catch (error: any) {
    console.error("Debug error:", error.message);
  }
}

// Run the debug function
debugGetInfo("tt4574334");
