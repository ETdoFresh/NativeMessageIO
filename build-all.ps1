# Get the directory where the script is located
$ScriptPath = $PSScriptRoot

$jobs = @()

Write-Host "Starting parallel builds from: $ScriptPath"

# Start build for browser-extension
$jobs += Start-Job -Name 'browser-extension' -ArgumentList $ScriptPath -ScriptBlock {
    param($ScriptDir)
    $ProjectDir = Join-Path $ScriptDir 'browser-extension'
    Push-Location $ProjectDir
    Write-Host "Building browser-extension... (npm install)"
    npm install
    Write-Host "Building browser-extension... (npm run build)"
    npm run build
    Pop-Location
}

# Start build for native-message-io
$jobs += Start-Job -Name 'native-message-io' -ArgumentList $ScriptPath -ScriptBlock {
    param($ScriptDir)
    $ProjectDir = Join-Path $ScriptDir 'native-message-io'
    Push-Location $ProjectDir
    Write-Host "Building native-message-io... (npm install)"
    npm install
    Write-Host "Building native-message-io... (npm run build)"
    npm run build
    Pop-Location
}

# Start build for ipc-client
$jobs += Start-Job -Name 'ipc-client' -ArgumentList $ScriptPath -ScriptBlock {
    param($ScriptDir)
    $ProjectDir = Join-Path $ScriptDir 'ipc-client'
    Push-Location $ProjectDir
    Write-Host "Building ipc-client... (npm install)"
    npm install
    Write-Host "Building ipc-client... (npm run build)"
    npm run build
    Pop-Location
}

Write-Host "Waiting for builds to complete..."
Wait-Job -Job $jobs | Out-Null

Write-Host "Builds finished. Retrieving output:"
$failed = $false
foreach ($job in $jobs) {
    Write-Host "--- Output for Job $($job.Id) ($($job.Name)) ---"
    Receive-Job -Job $job
    if ($job.State -eq 'Failed') {
        Write-Warning "Job $($job.Id) ($($job.Name)) failed."
        $failed = $true
    }
    Write-Host "--- End Output for Job $($job.Id) ---"
}

# Clean up jobs
Remove-Job -Job $jobs

if ($failed) {
    Write-Error "One or more builds failed."
    # Optionally exit with a non-zero status code
    # exit 1
} else {
    Write-Host "All projects built successfully!"
} 