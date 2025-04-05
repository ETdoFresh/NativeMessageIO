@echo off
setlocal

echo ======================================================
echo == Native Message IO - Windows Registry Installer ==
echo ======================================================

REM Determine the directory where this script resides
set "INSTALLER_DIR=%~dp0"

REM Define the native application name (must match manifest filename)
set "APP_NAME=etdofresh-native-message-io"

REM Construct the full path to the manifest file within this directory
set "MANIFEST_PATH=%INSTALLER_DIR%%APP_NAME%.json"

REM Define the registry key path
set "REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\%APP_NAME%"

echo.
echo Installer location: %INSTALLER_DIR%
echo Manifest file:      %MANIFEST_PATH%
echo Registry key:       %REG_KEY%
echo.

echo DEBUG: Checking existence of: "%MANIFEST_PATH%"

REM Check if the manifest file exists - If yes, jump to adding registry key
if exist "%MANIFEST_PATH%" goto FoundManifest

REM If file does NOT exist, show error and jump to end
echo ERROR: Manifest file '%APP_NAME%.json' not found in the installer directory (%INSTALLER_DIR%).
echo Please ensure the manifest file is present alongside this script.
goto End

:FoundManifest
REM Add the registry key
echo Attempting to add registry key...
REG ADD "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

REM Check the result
if %errorlevel% == 0 goto Success

REM If REG ADD failed
echo.
echo ERROR: Failed to register native host.
echo You might need to run this script as an Administrator.
goto End

:Success
echo.
echo SUCCESS: Native host '%APP_NAME%' registered successfully for the current user.
echo Firefox should now be able to find the native application via the manifest at:
echo %MANIFEST_PATH%
goto End

:End
echo.
echo Installation finished.
endlocal
pause 