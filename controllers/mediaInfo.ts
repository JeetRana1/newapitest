import { Request, Response } from "express";
import getInfo from "../lib/getInfo";

export default async function mediaInfo(req: Request, res: Response) {
  const { id } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }
  try {
    console.log(`Received request for ID: ${id}`);
    const data = await getInfo(id as string);
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