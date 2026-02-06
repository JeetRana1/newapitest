@echo off
echo ========================================
echo Deploying 8Stream API to Vercel
echo ========================================
echo.

echo Step 1: Adding all changes to Git...
git add .

echo.
echo Step 2: Committing changes...
git commit -m "Fix BASE_URL parsing and improve logging for Vercel deployment"

echo.
echo Step 3: Pushing to GitHub (this will trigger Vercel deployment)...
git push

echo.
echo ========================================
echo Deployment initiated!
echo ========================================
echo.
echo Vercel will automatically deploy your changes.
echo Wait 2-3 minutes, then test:
echo https://8-stream-api-navy.vercel.app/api/v1/mediaInfo?id=tt4574334
echo.
echo You can monitor the deployment at:
echo https://vercel.com/jeetranals-projects/8-stream-api
echo.
pause
