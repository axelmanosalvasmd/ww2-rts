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
rem Listen on all interfaces too, so tailnet members can use http://<this PC's Tailscale IP>:3000. Windows Firewall
rem decides who gets in: the rule "ww2-rts game (Tailscale only)" allows only Tailscale addresses (100.64.0.0/10).
set HOST=0.0.0.0
rem Record lag numbers to logs\diag-<room>.jsonl; read one with: node tools/diag.mjs
set WW2_DIAG=1
for /f %%i in ('tailscale ip -4 2^>nul') do echo   Or by Tailscale IP: http://%%i:3000
echo.
node server.js
pause
