@echo off
echo 🌱 Seeding image gallery with REAL cached files...
cd /d "%~dp0"
node seed.js
echo.
echo ✅ Database seeded with real cached archives! Press any key to continue...
pause > nul
