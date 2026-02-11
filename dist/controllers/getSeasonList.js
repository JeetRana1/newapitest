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
const cache_1 = __importDefault(require("../lib/cache"));
function getSeasonList(req, res) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const { id } = req.query;
        if (!id) {
            return res.json({
                success: false,
                message: "Please provide a valid id",
            });
        }
        // Check cache first
        const cacheKey = `getSeasonList_${id}`;
        const cachedResult = cache_1.default.get(cacheKey);
        if (cachedResult) {
            console.log(`[getSeasonList] Returning cached result for ID: ${id}`);
            return res.json(cachedResult);
        }
        try {
            const mediaInfo = yield (0, getInfo_1.default)(id);
            if (!mediaInfo.success) {
                const errorResult = { success: false, message: "Media not found" };
                // Cache the error result for 5 minutes
                cache_1.default.set(cacheKey, errorResult, 5 * 60 * 1000);
                return res.json(errorResult);
            }
            const playlist = (_a = mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.data) === null || _a === void 0 ? void 0 : _a.playlist;
            if (!playlist) {
                const errorResult = { success: false, message: "No content found" };
                // Cache the error result for 5 minutes
                cache_1.default.set(cacheKey, errorResult, 5 * 60 * 1000);
                return res.json(errorResult);
            }
            // if series
            const seasons = [];
            if ((_b = playlist[0]) === null || _b === void 0 ? void 0 : _b.title.includes("Season")) {
                playlist.forEach((season, i) => {
                    var _a, _b, _c, _d, _e;
                    let totalEpisodes = (_b = (_a = playlist[i]) === null || _a === void 0 ? void 0 : _a.folder) === null || _b === void 0 ? void 0 : _b.length;
                    let lang = [];
                    (_e = (_d = (_c = playlist[i]) === null || _c === void 0 ? void 0 : _c.folder[0]) === null || _d === void 0 ? void 0 : _d.folder) === null || _e === void 0 ? void 0 : _e.forEach((item) => {
                        if (item === null || item === void 0 ? void 0 : item.title)
                            lang.push(item.title);
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
                cache_1.default.set(cacheKey, result, 30 * 60 * 1000);
                return res.json(result);
            }
            else {
                // if movie
                let lang = [];
                playlist === null || playlist === void 0 ? void 0 : playlist.forEach((item) => {
                    if (item === null || item === void 0 ? void 0 : item.title)
                        lang.push(item.title);
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
                cache_1.default.set(cacheKey, result, 30 * 60 * 1000);
                return res.json(result);
            }
        }
        catch (err) {
            console.log("error: ", err);
            const errorResult = {
                success: false,
                message: "Internal server error",
            };
            // Cache the error result for 2 minutes
            cache_1.default.set(cacheKey, errorResult, 2 * 60 * 1000);
            res.json(errorResult);
        }
    });
}
exports.default = getSeasonList;
