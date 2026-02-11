import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import cache from "../lib/cache";

export default async function getSeasonList(req: Request, res: Response) {
  const { id } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }

  // Check cache first
  const cacheKey = `getSeasonList_${id}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`[getSeasonList] Returning cached result for ID: ${id}`);
    return res.json(cachedResult);
  }

  try {
    const mediaInfo = await getInfo(id as string);
    if (!mediaInfo.success) {
      const errorResult = { success: false, message: "Media not found" };
      
      // Cache the error result for 5 minutes
      cache.set(cacheKey, errorResult, 5 * 60 * 1000);
      
      return res.json(errorResult);
    }
    const playlist = mediaInfo?.data?.playlist;
    if (!playlist) {
      const errorResult = { success: false, message: "No content found" };
      
      // Cache the error result for 5 minutes
      cache.set(cacheKey, errorResult, 5 * 60 * 1000);
      
      return res.json(errorResult);
    }
    // if series
    const seasons: { season: string; totalEpisodes: number; lang: string[] }[] =
      [];
    if (playlist[0]?.title.includes("Season")) {
      playlist.forEach((season: any, i: number) => {
        let totalEpisodes = playlist[i]?.folder?.length;
        let lang: string[] = [];
        playlist[i]?.folder[0]?.folder?.forEach((item: any) => {
          if (item?.title) lang.push(item.title);
        });
        seasons.push({
          season: season.title,
          totalEpisodes,
          lang,
        });
      });
      const result = {
        success: true,
        data: { seasons, type: "tv" },
      };
      
      // Cache the result for 30 minutes
      cache.set(cacheKey, result, 30 * 60 * 1000);
      
      return res.json(result);
    } else {
      // if movie
      let lang: string[] = [];
      playlist?.forEach((item: any) => {
        if (item?.title) lang.push(item.title);
      });
      const result = {
        success: true,
        data: {
          seasons: [
            {
              lang,
            },
          ],
          type: "movie",
        },
      };
      
      // Cache the result for 30 minutes
      cache.set(cacheKey, result, 30 * 60 * 1000);
      
      return res.json(result);
    }
  } catch (err) {
    console.log("error: ", err);
    
    const errorResult = {
      success: false,
      message: "Internal server error",
    };
    
    // Cache the error result for 2 minutes
    cache.set(cacheKey, errorResult, 2 * 60 * 1000);
    
    res.json(errorResult);
  }
}
