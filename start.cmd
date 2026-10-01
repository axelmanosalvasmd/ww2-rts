@echo off
rem Double-click to host: starts the game server and publishes it over HTTPS to people
rem who can reach this PC on Tailscale. Leave this window open while you play.
cd /d "%~dp0"
rem Funnel = a public link that works without Tailscale (needs the tailnet admin to allow it); else tailnet only
tailscale funnel --bg 3000 >nul 2>&1 || tailscale serve --bg 3000 >nul
echo.
echo   Game: https://desktop-snrmhuu.tail859aa4.ts.net
echo   (send your friends that link with the room code the lobby gives you)
tailscale funnel status 2>nul | find "Funnel on" >nul && echo   Public link: anyone with it can join, no Tailscale needed.
echo.
node server.js
pause
