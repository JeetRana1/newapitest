# 8Stream API - Vercel Deployment Guide

## Prerequisites
1. Install Vercel CLI: `npm i -g vercel`
2. Create a Vercel account at https://vercel.com

## Deployment Steps

### 1. Login to Vercel
```bash
vercel login
```

### 2. Deploy to Vercel
```bash
cd c:\Users\Jeet\Documents\8Stream-API
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? Select your account
- Link to existing project? **N**
- Project name? **8stream-api** (or your preferred name)
- Directory? **./** (press Enter)
- Override settings? **N**

### 3. Set Environment Variables (Optional)
If you need to set environment variables:
```bash
vercel env add BASE_URL
vercel env add RATE_LIMIT
```

Or set them in the Vercel dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add:
   - `BASE_URL`: `https://allmovieland.link/player.js?v=60%20128`
   - `RATE_LIMIT`: `true`

### 4. Deploy to Production
```bash
vercel --prod
```

## Your API Endpoints
After deployment, your API will be available at:
- `https://your-project.vercel.app/api/v1/mediaInfo?id=tt1375666`
- `https://your-project.vercel.app/api/v1/getStream` (POST)
- `https://your-project.vercel.app/api/v1/getSeasonList?id=tt4574334`

## Update Your Frontend
In your `player.html`, change:
```javascript
const LOCAL_API_URL = 'http://localhost:3000/api/v1';
```

To:
```javascript
const LOCAL_API_URL = 'https://your-project.vercel.app/api/v1';
```

## Testing
Test your deployed API:
```bash
curl https://your-project.vercel.app/api/v1/mediaInfo?id=tt1375666
```

## Troubleshooting
- If deployment fails, check `vercel logs`
- Ensure all dependencies are in `package.json`
- TypeScript files will be compiled automatically by Vercel
