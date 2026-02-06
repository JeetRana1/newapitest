import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes/route";
import rateLimit from "express-rate-limit";
import { getPlayerUrl } from "./lib/getPlayerUrl";

const app = express();

app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);
dotenv.config();
app.use(express.json());

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000, // Increased limit for streaming usage
  message: "Too many requests, please try again later.",
});
if (process.env.RATE_LIMIT === "true") {
  app.use(limiter);
}
app.use("/api/v1", router);

// Debug endpoint to test getPlayerUrl
app.get("/debug/player-url", async (req, res) => {
  try {
    const playerUrl = await getPlayerUrl();
    res.json({ playerUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("its ok");
});

const Port = process.env.PORT || 5001;

if (process.env.NODE_ENV !== 'production') {
  app.listen(Port, () => {
    console.log(`Server running on port ${Port}`);
  });
}

export default app;