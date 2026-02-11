"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const route_1 = __importDefault(require("./routes/route"));
const cache_1 = __importDefault(require("./lib/cache"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
}));
dotenv_1.default.config();
app.use(express_1.default.json());
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
    const providedKey = req.query.key;
    if (providedKey === adminKey) {
        cache_1.default.clear();
        res.json({ success: true, message: "Cache cleared successfully" });
    }
    else {
        res.status(401).json({ success: false, message: "Unauthorized" });
    }
});
// Alias for relative path streaming (catches /stream/ requests from root)
const proxy_1 = __importDefault(require("./controllers/proxy"));
app.all("/stream/*", proxy_1.default);
app.use("/api/v1", route_1.default);
const Port = process.env.PORT || 7860;
app.listen(Port, () => {
    console.log(`Server running on port ${Port}`);
});
exports.default = app;
