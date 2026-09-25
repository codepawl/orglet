@echo off
rem The orglet command (COD-234). Lives in resources\bin; runs the CLI script with Orglet.exe as Node.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Orglet.exe" "%~dp0..\orglet-cli.cjs" %*
endlocal & exit /b %ERRORLEVEL%
