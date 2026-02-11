"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mediaInfo_1 = __importDefault(require("../controllers/mediaInfo"));
const getStream_1 = __importDefault(require("../controllers/getStream"));
const getSeasonList_1 = __importDefault(require("../controllers/getSeasonList"));
const proxy_1 = __importDefault(require("../controllers/proxy"));
const router = express_1.default.Router();
router.get("/mediaInfo", mediaInfo_1.default);
router.post("/getStream", getStream_1.default);
router.get("/getSeasonList", getSeasonList_1.default);
router.get("/proxy", proxy_1.default); // New CORS Proxy route
router.all("/stream/*", proxy_1.default); // Handle encoded streaming paths
exports.default = router;
