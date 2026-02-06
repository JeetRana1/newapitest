import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "../routes/route";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();

app.use(
    cors({
        origin: "*",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE"],
    })
);

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

app.get("/", (req, res) => {
    res.send("8Stream API is running");
});

app.get("/api", (req, res) => {
    res.send("8Stream API is running");
});

export default app;
