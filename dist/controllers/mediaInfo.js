"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const getInfo_1 = __importDefault(require("../lib/getInfo"));
const tmdbResolver_1 = require("../lib/tmdbResolver");
const cache_1 = __importDefault(require("../lib/cache"));
function mediaInfo(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        let { id, type } = req.query;
        if (!id) {
            return res.json({
                success: false,
                message: "Please provide a valid id",
            });
        }
        // Create cache key for the entire mediaInfo request
        const cacheKey = `mediaInfo_${id}_${type || 'movie'}`;
        const cachedResult = cache_1.default.get(cacheKey);
        if (cachedResult) {
            console.log(`[mediaInfo] Returning cached result for ID: ${id}`);
            return res.json(cachedResult);
        }
        try {
            let finalId = id;
            // Auto-resolve TMDB IDs (e.g. 550 -> tt0137523)
            if (!finalId.startsWith('tt')) {
                finalId = yield (0, tmdbResolver_1.resolveTmdbToImdb)(finalId, type || 'movie');
            }
            console.log(`Received request for ID: ${id} (Resolved: ${finalId})`);
            const data = yield (0, getInfo_1.default)(finalId);
            console.log(`Response data:`, data);
            // Cache the result if successful
            if (data.success) {
                cache_1.default.set(cacheKey, data, 30 * 60 * 1000); // Cache successful results for 30 minutes
            }
            else {
                // Cache failed results for shorter duration to allow retries
                cache_1.default.set(cacheKey, data, 5 * 60 * 1000); // Cache failed results for 5 minutes
            }
            res.json(data);
        }
        catch (err) {
            console.log("error in mediaInfo: ", err);
            // Send error response
            const errorResponse = {
                success: false,
                message: "Internal server error: " + (err instanceof Error ? err.message : String(err)),
            };
            // Cache the error response for a short time to prevent repeated error requests
            cache_1.default.set(cacheKey, errorResponse, 2 * 60 * 1000); // Cache error for 2 minutes
            res.status(500).json(errorResponse);
        }
    });
}
exports.default = mediaInfo;
