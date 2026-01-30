import axios from "axios";

export async function getPlayerUrl() {
  const baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("BASE_URL environment variable is not set");
  }

  try {
    const res = await axios.get(baseUrl);
    const resText = res.data;
    const playerUrlMatch = resText.match(/const AwsIndStreamDomain\s*=\s*'([^']+)'/);

    if (!playerUrlMatch) {
      throw new Error("Could not find player URL in the response");
    }
    return playerUrlMatch[1];
  } catch (error: any) {
    throw new Error(`Failed to fetch player URL: ${error.message}`);
  }
}
