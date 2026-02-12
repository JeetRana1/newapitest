import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveImdbToTmdb, resolveTmdbToImdb } from "../lib/tmdbResolver";
import cache from "../lib/cache";

export default async function mediaInfo(req: Request, res: Response) {
  let { id, type } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }

  // Create cache key for the entire mediaInfo request
  const cacheKey = `mediaInfo_${id}_${type || 'movie'}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`[mediaInfo] Returning cached result for ID: ${id}`);
    return res.json(cachedResult);
  }

  try {
    let finalId = id as string;

    // Auto-resolve TMDB IDs (e.g. 550 -> tt0137523)
    if (!finalId.startsWith('tt')) {
      finalId = await resolveTmdbToImdb(finalId, (type as any) || 'movie');
    }

    console.log(`Received request for ID: ${id} (Resolved: ${finalId})`);
    let data = await getInfo(finalId);

    // Upstream providers sometimes stop supporting imdb IDs on /play/*.
    // If imdb lookup fails, retry once using TMDB numeric ID.
    if (!data.success && finalId.startsWith('tt')) {
      const tmdbFallbackId = await resolveImdbToTmdb(finalId, (type as any) || 'movie');
      if (tmdbFallbackId && tmdbFallbackId !== finalId) {
        console.log(`[mediaInfo] IMDb lookup failed. Retrying with TMDB ID: ${tmdbFallbackId}`);
        data = await getInfo(tmdbFallbackId);
      }
    }

    console.log(`Response data:`, data);
    
    // Cache the result if successful
    if (data.success) {
      cache.set(cacheKey, data, 24 * 60 * 60 * 1000); // Cache successful results for 24 hours
    } else {
      // Cache failed results for shorter duration to allow retries
      cache.set(cacheKey, data, 5 * 60 * 1000); // Cache failed results for 5 minutes
    }
    
    res.json(data);
  } catch (err) {
    console.log("error in mediaInfo: ", err);
    
    // Send error response
    const errorResponse = {
      success: false,
      message: "Internal server error: " + (err instanceof Error ? err.message : String(err)),
    };
    
    // Cache the error response for a short time to prevent repeated error requests
    cache.set(cacheKey, errorResponse, 2 * 60 * 1000); // Cache error for 2 minutes
    
    res.status(500).json(errorResponse);
  }
}
