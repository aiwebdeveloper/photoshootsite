@echo off
cd /d "%~dp0"
title VisionForge Studio
echo Starting VisionForge Studio...
echo.
echo Open this in your browser:
echo http://localhost:3000
echo.
echo Keep this window open while using the app.
echo Press Ctrl+C to stop the server.
echo.
"C:\Program Files\nodejs\node.exe" server.js
