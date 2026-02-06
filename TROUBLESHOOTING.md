# Quick Fix for Vercel Deployment

## The Issue
The BASE_URL is trying to scrape a player URL, but it's failing and falling back to the dead `vekna402las.com` domain.

## Solution: Update Environment Variable

Go to Vercel Dashboard and update the BASE_URL:

### Option 1: Try the .io domain directly
1. Go to: https://vercel.com/jeetranals-projects/8-stream-api/settings/environment-variables
2. Edit the `BASE_URL` variable
3. Change value to: `https://allmovieland.io/player.js`
4. Save and redeploy

### Option 2: Use the .link domain
1. Change `BASE_URL` to: `https://allmovieland.link/player.js`
2. Save and redeploy

### Option 3: Test locally first
Before deploying, let's test which URL works:

```bash
cd c:\Users\Jeet\Documents\8Stream-API
```

Update your local `.env` to:
```
PORT=3000
BASE_URL=https://allmovieland.io/player.js
RATE_LIMIT=true
```

Then test locally:
```bash
node dist/index.js
```

Test: http://localhost:3000/api/v1/mediaInfo?id=tt4574334

If it works locally, update Vercel's BASE_URL to the same value.

## Alternative: Remove the version parameter
The `?v=60%20128` might be causing issues. Try just:
```
https://allmovieland.link/player.js
```

## Check Vercel Logs
To see what's actually happening:
1. Go to: https://vercel.com/jeetranals-projects/8-stream-api
2. Click on the latest deployment
3. Click "Functions" tab
4. Look for the logs to see what BASE_URL is being used
