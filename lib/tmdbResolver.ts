import axios from "axios";

/**
 * Automatically converts TMDB IDs to IMDB IDs (tt...) 
 * This allows the API to "just work" even if the user sends TMDB IDs.
 */
export async function resolveTmdbToImdb(id: string, type: 'movie' | 'tv' = 'movie'): Promise<string> {
    // If it already looks like an IMDB ID, return it
    if (id.startsWith('tt')) return id;

    console.log(`[TMDB Resolver] Detected TMDB ID: ${id}. Attempting conversion...`);

    try {
        // Try public TMDB proxy (no API key required for these endpoints usually or using a public one)
        // We'll scrape the ID from the TMDB page if we have to, 
        // but let's try a widely available public helper first.
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
            console.log(`[TMDB Resolver] Successfully converted ${id} -> ${match[1]}`);
            return match[1];
        }

        // Fallback for TV shows where patterns might be different
        if (type === 'tv') {
            const tvMatch = html.match(/["']imdb_id["']\s*:\s*["'](tt\d+)["']/);
            if (tvMatch) return tvMatch[1];
        }

        console.log(`[TMDB Resolver] Could not find IMDB ID on TMDB page for ${id}.`);
        return id; // Return original and hope for the best
    } catch (e: any) {
        console.log(`[TMDB Resolver] Conversion failed: ${e.message}`);
        return id;
    }
}
