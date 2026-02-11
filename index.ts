import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes/route";
import rateLimit from "express-rate-limit";
import cache from "./lib/cache";

const app = express();
app.set("trust proxy", true);

app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);
dotenv.config();
app.use(express.json());

// Temporarily disabling rate limiter to avoid proxy issues on Vercel
// const limiter = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   max: 1000, // Increased limit for streaming usage
//   message: "Too many requests, please try again later.",
// });
// if (process.env.RATE_LIMIT === "true") {
//   app.use(limiter);
// }
app.get("/", (req, res) => {
  res.send("its ok");
});

// Endpoint to clear cache (for debugging purposes)
app.get("/admin/clear-cache", (req, res) => {
  const adminKey = process.env.ADMIN_KEY || "admin123"; // Default key for development
  const providedKey = req.query.key as string;
  
  if (providedKey === adminKey) {
    cache.clear();
    res.json({ success: true, message: "Cache cleared successfully" });
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
});

// Alias for relative path streaming (catches /stream/ requests from root)
import proxy from "./controllers/proxy";
app.all("/stream/*", proxy);
app.use("/api/v1", router);

const Port = process.env.PORT || 7860;

app.listen(Port, () => {
  console.log(`Server running on port ${Port}`);
});

export default app;
