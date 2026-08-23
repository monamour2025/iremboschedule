$ErrorActionPreference = "Stop"
$Repo = "monamour2025/iremboschedule"
$WebsiteUrl = "iremboschedule-seven.vercel.app"

function Get-DotEnvValue([string]$key) {
  foreach ($file in @(".env.local", ".env")) {
    if (-not (Test-Path $file)) { continue }
    $line = Select-String -Path $file -Pattern "^$key=" | Select-Object -First 1
    if ($line) {
      return (($line.Line -split "=", 2)[1]).Trim().Trim('"').Trim([char]13).Trim([char]10)
    }
  }
  return $null
}

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "GitHub CLI (gh) not found. Install: winget install GitHub.cli"
}

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "Not logged into GitHub. Run: gh auth login"
}

$cronSecret = Get-DotEnvValue "CRON_SECRET"
if (-not $cronSecret) {
  Write-Error "CRON_SECRET not found in .env or .env.local"
}

Write-Host "Setting CRON_SECRET (length=$($cronSecret.Length)) on $Repo ..."
$cronSecret | gh secret set CRON_SECRET --repo $Repo

Write-Host "Setting WEBSITE_URL=$WebsiteUrl on $Repo ..."
$WebsiteUrl | gh secret set WEBSITE_URL --repo $Repo

Write-Host ""
Write-Host "Repository secrets:"
gh secret list --repo $Repo

Write-Host ""
Write-Host "Triggering schedule-scan workflow ..."
gh workflow run schedule-scan.yml --repo $Repo
Write-Host "Workflow dispatch requested."
