# Environment Variables for Vercel

Add these in your Vercel Dashboard:
https://vercel.com/jeetranals-projects/8-stream-api/settings/environment-variables

## Variable 1: BASE_URL
- **Name:** `BASE_URL`
- **Value:** `https://allmovieland.link/player.js?v=60%20128`
- **Environments:** ✅ Production, ✅ Preview, ✅ Development

## Variable 2: RATE_LIMIT
- **Name:** `RATE_LIMIT`
- **Value:** `true`
- **Environments:** ✅ Production, ✅ Preview, ✅ Development

## After Adding:
1. Go to the "Deployments" tab
2. Click the three dots (...) on your latest deployment
3. Click "Redeploy"
4. Wait for deployment to complete
5. Test again: https://8-stream-api-navy.vercel.app/api/v1/mediaInfo?id=tt1375666

---

## Alternative: Test with a different movie
The streaming source might not have Inception (tt1375666). Try:
- Stranger Things: https://8-stream-api-navy.vercel.app/api/v1/mediaInfo?id=tt4574334
- The Housemaid: https://8-stream-api-navy.vercel.app/api/v1/mediaInfo?id=tt27543632
