@echo off
rem Double-click to host: starts the game server and publishes it over HTTPS to people
rem who can reach this PC on Tailscale. Leave this window open while you play.
cd /d "%~dp0"
tailscale serve --bg 3000 >nul
echo.
echo   Game: https://desktop-snrmhuu.tail859aa4.ts.net
echo   (send your friends that link with the room code the lobby gives you)
echo.
node server.js
pause
