@echo off
REM Get the directory where this batch file resides
cd /d %~dp0
cd ..
set ROOT_DIR=%cd%

REM Adjust the relative path to your node executable and script if needed
REM Ensure the path to node.exe is correct or node is in your system PATH
node "%ROOT_DIR%native-host\dist\index.js" %* 