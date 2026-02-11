"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const getPlayerUrl_1 = require("./getPlayerUrl");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const torAgent = new socks_proxy_agent_1.SocksProxyAgent('socks5h://127.0.0.1:9050');
function getInfo(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const playerUrl = yield (0, getPlayerUrl_1.getPlayerUrl)();
            const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];
            let lastError = null;
            for (const path of paths) {
                const targetUrl = `${playerUrl.replace(/\/$/, '')}${path}`;
                console.log(`[getInfo] Trying path: ${targetUrl}`);
                // Try with Tor first for better bypass
                const referers = ["https://allmovieland.link/", "https://google.com/"];
                for (const referer of referers) {
                    try {
                        const response = yield axios_1.default.get(targetUrl, {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                                "Accept-Language": "en-US,en;q=0.9",
                                "Referer": referer,
                                "Origin": referer.replace(/\/$/, ''),
                                "Cache-Control": "max-age=0"
                            },
                            httpAgent: torAgent,
                            httpsAgent: torAgent,
                            timeout: 15000
                        });
                        if (response.status === 200) {
                            const $ = cheerio.load(response.data);
                            const script = $("script").last().html();
                            if (!script)
                                continue;
                            const contentMatch = script.match(/(\{[^;]+});/) || script.match(/\((\{.*\})\)/);
                            if (!contentMatch || !contentMatch[1])
                                continue;
                            const data = JSON.parse(contentMatch[1]);
                            const file = data["file"];
                            const key = data["key"];
                            if (!file)
                                continue;
                            const link = file.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;
                            const playlistRes = yield axios_1.default.get(link, {
                                headers: {
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                                    "Accept": "*/*",
                                    "Referer": targetUrl,
                                    "X-Csrf-Token": key
                                },
                                httpAgent: torAgent,
                                httpsAgent: torAgent,
                                timeout: 15000
                            });
                            const playlist = Array.isArray(playlistRes.data)
                                ? playlistRes.data.filter((item) => item && (item.file || item.folder))
                                : [];
                            if (playlist.length > 0) {
                                return {
                                    success: true,
                                    data: {
                                        playlist,
                                        key,
                                    },
                                };
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[getInfo] Failed path ${targetUrl} with referer ${referer}: ${e.message}`);
                        lastError = e;
                    }
                }
            }
            return {
                success: false,
                message: lastError ? `API Error: ${lastError.message}` : "Media not found on any known paths"
            };
        }
        catch (error) {
            console.error(`Error in getInfo:`, error.message);
            return {
                success: false,
                message: `API Error: ${error.message}`,
            };
        }
    });
}
exports.default = getInfo;
