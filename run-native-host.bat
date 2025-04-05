@echo off
REM Get the directory where this batch file resides
set SCRIPT_DIR=%~dp0
REM Adjust the relative path to your node executable and script if needed
REM Ensure the path to node.exe is correct or node is in your system PATH
node "%SCRIPT_DIR%native-host\dist\index.js" %* 