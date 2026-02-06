import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveTmdbToImdb } from "../lib/tmdbResolver";

export default async function mediaInfo(req: Request, res: Response) {
  let { id, type } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }

  try {
    let finalId = id as string;

    // Auto-resolve TMDB IDs (e.g. 550 -> tt0137523)
    if (!finalId.startsWith('tt')) {
      finalId = await resolveTmdbToImdb(finalId, (type as any) || 'movie');
    }

    console.log(`Received request for ID: ${id} (Resolved: ${finalId})`);
    const data = await getInfo(finalId);
    console.log(`Response data:`, data);
    res.json(data);
  } catch (err) {
    console.log("error in mediaInfo: ", err);
    res.status(500).json({
      success: false,
      message: "Internal server error: " + (err instanceof Error ? err.message : String(err)),
    });
  }
}