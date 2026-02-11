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
const axios_1 = __importDefault(require("axios"));
const getPlayerUrl_1 = require("../lib/getPlayerUrl");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const torAgent = new socks_proxy_agent_1.SocksProxyAgent('socks5h://127.0.0.1:9050');
function getStream(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { file, key } = req.body;
        if (!file || !key) {
            return res.status(400).json({ success: false, message: "Missing file or key" });
        }
        try {
            let finalStreamUrl = "";
            let token = decodeURIComponent(file);
            let proxyRef = "";
            // Support for proxy_ref hint in token
            if (token.includes('proxy_ref=')) {
                const parts = token.split('?');
                token = parts[0];
                const searchParams = new URLSearchParams(parts[1]);
                proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");
            }
            if (token.startsWith('http')) {
                finalStreamUrl = token;
            }
            else {
                // New logic: fetch token from mirror
                const baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : yield (0, getPlayerUrl_1.getPlayerUrl)()).replace(/\/$/, '');
                const path = token.startsWith('~') ? token.slice(1) : token;
                const playlistUrl = `${baseDomain}/playlist/${path}.txt`;
                console.log(`[getStream] Mirroring from: ${baseDomain}`);
                const response = yield axios_1.default.get(playlistUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": baseDomain + "/",
                        "X-Csrf-Token": key
                    },
                    httpAgent: torAgent,
                    httpsAgent: torAgent,
                    timeout: 15000,
                });
                finalStreamUrl = response.data;
            }
            if (!finalStreamUrl || typeof finalStreamUrl !== 'string' || !finalStreamUrl.startsWith('http')) {
                return res.status(500).json({ success: false, message: "Invalid stream URL received from mirror" });
            }
            // Wrap in Proxy
            const host = req.get('host');
            const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
            const proxiedLink = `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;
            res.json({
                success: true,
                data: {
                    link: proxiedLink
                }
            });
        }
        catch (err) {
            console.error(`[getStream] Error: ${err.message}`);
            res.status(500).json({ success: false, message: err.message });
        }
    });
}
exports.default = getStream;
