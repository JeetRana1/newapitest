# 8Stream API

A robust streaming API that fetches and proxies video content from various sources with improved reliability and TMDB integration.

## Features

- **Improved Reliability**: Enhanced error handling and retry mechanisms to reduce errors on first try
- **TMDB Integration**: Automatic conversion of TMDB IDs to IMDB IDs using the official TMDB API
- **Caching System**: In-memory caching for faster response times and reduced load on external sources
- **Proxy Support**: Built-in proxy with Tor support for accessing restricted content
- **HLS Support**: Full support for HLS streaming with manifest rewriting

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd 8stream-api
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with the following variables:
```env
PORT=7860
TMDB_API_KEY=your_tmdb_api_key_here
ADMIN_KEY=your_admin_key_for_cache_clearing
BASE_URL=https://allmovieland.link/player.js
SCRAPER_REFERER=https://allmovieland.link/
SCRAPER_ORIGIN=https://allmovieland.link
PLAYER_FALLBACK_URLS=https://allmovieland.link/player.js,https://allmovieland.io/player.js
PLAYER_HARDCODED_FALLBACK=https://vekna402las.com
INFO_REFERERS=https://allmovieland.link/,https://google.com/
PROXY_DEFAULT_REFERER=https://allmovieland.link/
PROXY_SLIME_REFERER=https://vekna402las.com/
PROXY_VIDSRC_REFERER=https://vidsrc.me/
PROXY_VIDLINK_REFERER=https://vidlink.pro/
PROXY_SUPEREMBED_REFERER=https://superembed.stream/
```

4. Build and run the application:
```bash
npm run build
npm start
```

## API Endpoints

### GET /api/v1/mediaInfo
Fetches media information for a given ID.

Parameters:
- `id` (required): The media ID (IMDB or TMDB ID)
- `type` (optional): Media type ('movie' or 'tv', defaults to 'movie')

Example:
```
GET /api/v1/mediaInfo?id=tt0111161
```

### POST /api/v1/getStream
Gets a stream URL for a given file and key.

Body:
- `file` (required): The file identifier
- `key` (required): The access key

Example:
```json
{
  "file": "some_file_identifier",
  "key": "some_access_key"
}
```

### GET /api/v1/getSeasonList
Gets season and episode information for a given ID.

Parameters:
- `id` (required): The media ID (IMDB or TMDB ID)

Example:
```
GET /api/v1/getSeasonList?id=tt0944947
```

### GET /admin/clear-cache
Clears the in-memory cache (requires admin key).

Parameters:
- `key` (required): The admin key

Example:
```
GET /admin/clear-cache?key=your_admin_key
```

## Caching

The API implements a comprehensive caching system:
- Successful mediaInfo results are cached for 30 minutes
- Failed mediaInfo results are cached for 5 minutes
- Stream results are cached for 10 minutes
- TMDB to IMDB conversions are cached for 24 hours
- Proxy responses are cached for 5 minutes

## TMDB Integration

The API automatically converts TMDB IDs to IMDB IDs using the official TMDB API. If the official API fails, it falls back to web scraping as a backup method.

## Troubleshooting

- If you're getting errors with TMDB IDs, make sure your TMDB_API_KEY is set correctly in the environment variables
- If streams are not loading reliably, try clearing the cache using the admin endpoint
- Check the logs for detailed error information
