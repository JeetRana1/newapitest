@echo off
echo Installing dependencies...
npm install

echo Building TypeScript files...
npx tsc

if %ERRORLEVEL% == 0 (
  echo Build completed successfully!
  echo You can now run the application with: npm start
  echo.
  echo To start the server:
  echo - Make sure you have Tor running on port 9050
  echo - Run: npm start
) else (
  echo Build failed!
  pause
)