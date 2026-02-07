@echo off
echo Building the project...
npx tsc
if %ERRORLEVEL% == 0 (
  echo Build completed successfully!
) else (
  echo Build failed!
  pause
)