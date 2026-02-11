import axios from "axios";
import cache from './cache';

/**
 * Automatically converts TMDB IDs to IMDB IDs (tt...)
 * This allows the API to "just work" even if the user sends TMDB IDs.
 */
export async function resolveTmdbToImdb(id: string, type: 'movie' | 'tv' = 'movie'): Promise<string> {
    // If it already looks like an IMDB ID, return it
    if (id.startsWith('tt')) return id;

    // Check cache first
    const cacheKey = `tmdb_to_imdb_${type}_${id}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        console.log(`[TMDB Resolver] Returning cached result for ${id} -> ${cachedResult}`);
        return cachedResult;
    }

    console.log(`[TMDB Resolver] Detected TMDB ID: ${id}. Attempting conversion...`);

    try {
        // Use the official TMDB API with API key from environment variables
        const apiKey = process.env.TMDB_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4YmVjZTUzZGE1NjM4MjA5M2QwMjMwYzA1Zjg4YzlhMCIsInN1YiI6IjY1NmM0MjcxNjVmMzQzMDE0MzRhMzdhNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.jV5CJmGBbqN2J5o2M9Q49s5Q7jY7Q7Q7Q7Q7Q7Q7Q7Q'; // Public API key - should be replaced with your own
        const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${apiKey}&language=en-US`;
        
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
            },
            timeout: 10000
        });

        const data = response.data;
        if (data.imdb_id) {
            console.log(`[TMDB Resolver] Successfully converted ${id} -> ${data.imdb_id}`);
            
            // Cache the result for 24 hours
            cache.set(cacheKey, data.imdb_id, 24 * 60 * 60 * 1000);
            
            return data.imdb_id;
        }

        console.log(`[TMDB Resolver] Could not find IMDB ID in API response for ${id}.`);
        return id; // Return original and hope for the best
    } catch (e: any) {
        console.log(`[TMDB Resolver] API conversion failed: ${e.message}`);
        
        // Fallback to scraping method if API fails
        try {
            console.log('[TMDB Resolver] Falling back to scraping method...');
            const url = `https://www.themoviedb.org/${type}/${id}`;
            const response = await axios.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                },
                timeout: 10000
            });

            const html = response.data.toString();
            // Look for the IMDB link in the page
            const match = html.match(/https:\/\/www\.imdb\.com\/title\/(tt\d+)/);

            if (match && match[1]) {
                const imdbId = match[1];
                console.log(`[TMDB Resolver] Successfully converted ${id} -> ${imdbId} via scraping`);
                
                // Cache the result for 24 hours
                cache.set(cacheKey, imdbId, 24 * 60 * 60 * 1000);
                
                return imdbId;
            }

            // Fallback for TV shows where patterns might be different
            if (type === 'tv') {
                const tvMatch = html.match(/["']imdb_id["']\s*:\s*["'](tt\d+)["']/);
                if (tvMatch) {
                    const imdbId = tvMatch[1];
                    console.log(`[TMDB Resolver] Successfully converted ${id} -> ${imdbId} via scraping (TV)`);
                    
                    // Cache the result for 24 hours
                    cache.set(cacheKey, imdbId, 24 * 60 * 60 * 1000);
                    
                    return imdbId;
                }
            }
        } catch (scrapeError: any) {
            console.log(`[TMDB Resolver] Scraping also failed: ${scrapeError.message}`);
        }

        console.log(`[TMDB Resolver] Both API and scraping failed for ${id}. Returning original ID.`);
        return id;
    }
}
