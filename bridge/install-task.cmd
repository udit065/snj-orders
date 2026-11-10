@echo off
rem Makes Windows run the SNJ Orders bridge every 3 minutes, in the background,
rem so it keeps going when your remote connection drops. Double-click to install.
rem It reads Tally only while TallyPrime is open with the company loaded.
cd /d "%~dp0"
set "PYW=C:\Program Files\Python314\pythonw.exe"
if not exist "%PYW%" for /f "delims=" %%p in ('where pythonw 2^>nul') do set "PYW=%%p"
if not exist "%PYW%" (
  echo Could not find pythonw.exe. Is Python installed?
  pause
  exit /b 1
)
schtasks /create /f /tn "SNJ Orders Bridge" /sc minute /mo 3 /tr "\"%PYW%\" \"%~dp0bridge.py\" --once"
if errorlevel 1 (
  echo.
  echo Windows did not allow the task. Send a photo of this window.
  pause
  exit /b 1
)
schtasks /run /tn "SNJ Orders Bridge"
echo.
echo Installed. The bridge now runs every 3 minutes by itself.
echo To see what it is doing, open bridge.log in this folder.
echo To remove it: schtasks /delete /tn "SNJ Orders Bridge" /f
pause
