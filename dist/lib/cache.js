"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Simple in-memory cache for storing resolved IDs and fetched data
class Cache {
    constructor() {
        this.cache = new Map();
    }
    set(key, data, ttl = 30 * 60 * 1000) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
}
exports.default = new Cache();
