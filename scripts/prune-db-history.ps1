[CmdletBinding()]
param(
  [string]$RepoPath = (Get-Location).Path,
  [string]$Path = "trading_app.db",
  [ValidateRange(1, 1000)]
  [int]$Keep = 6,
  [string]$Remote = "origin",
  [switch]$Force,
  [switch]$Push,
  [switch]$AutoInstallFilterRepo,
  [switch]$SkipBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Git {
  param(
    [Parameter(Mandatory)] [string[]]$Args,
    [switch]$AllowFailure
  )

  $output = & git @Args 2>&1
  $exitCode = $LASTEXITCODE
  $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"

  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "git $($Args -join ' ') failed ($exitCode):`n$text"
  }

  return $text.TrimEnd()
}

function Get-UniqueBlobs {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [int]$MaxUniqueToReturn
  )

  $commitText = Invoke-Git @("log", "--all", "--diff-filter=AM", "--format=%H", "--", $FilePath) -AllowFailure
  if (-not $commitText) {
    return @()
  }

  $commits = $commitText -split "`n" | Where-Object { $_ }
  $seen = New-Object System.Collections.Generic.HashSet[string]
  $ordered = New-Object System.Collections.Generic.List[string]

  foreach ($commit in $commits) {
    $blob = Invoke-Git @("rev-parse", "$commit`:$FilePath") -AllowFailure
    if (-not $blob) { continue }
    if ($seen.Add($blob)) {
      [void]$ordered.Add($blob)
      if ($ordered.Count -ge $MaxUniqueToReturn) { break }
    }
  }

  return @($ordered.ToArray())
}

$repoFullPath = (Resolve-Path -Path $RepoPath).Path
Push-Location $repoFullPath
try {
  $isRepo = Invoke-Git @("rev-parse", "--is-inside-work-tree") -AllowFailure
  if ($isRepo -ne "true") {
    throw "Not a git work tree: $repoFullPath"
  }

  $gitStatus = Invoke-Git @("status", "--porcelain")
  if ($gitStatus) {
    throw "Working tree not clean. Commit/stash first."
  }

  $normalizedPath = $Path.Replace("\", "/")

  $uniqueUpToKeepPlusOne = Get-UniqueBlobs -FilePath $normalizedPath -MaxUniqueToReturn ($Keep + 1)
  if ($uniqueUpToKeepPlusOne.Count -le $Keep) {
    Write-Host "No cleanup needed: '$normalizedPath' has $($uniqueUpToKeepPlusOne.Count) unique version(s) in history (threshold $Keep)."
    return
  }

  if (-not $Force) {
    Write-Host "Cleanup needed: '$normalizedPath' has >$Keep unique versions in history."
    Write-Host "Refusing to rewrite history without -Force."
    Write-Host "Run: .\\scripts\\prune-db-history.ps1 -Path `"$normalizedPath`" -Keep $Keep -Force" + ($(if ($Push) { " -Push" } else { "" }))
    return
  }

  $remoteUrl = Invoke-Git @("remote", "get-url", $Remote) -AllowFailure
  if (-not $remoteUrl -and $Push) {
    throw "Remote '$Remote' not found; cannot push."
  }

  $filterRepoVersion = Invoke-Git @("filter-repo", "--version") -AllowFailure
  if (-not $filterRepoVersion) {
    if (-not $AutoInstallFilterRepo) {
      throw "git-filter-repo not found. Install with: python -m pip install --user git-filter-repo (or rerun with -AutoInstallFilterRepo)."
    }
    & python -m pip install --user git-filter-repo | Out-Host
    $filterRepoVersion = Invoke-Git @("filter-repo", "--version")
  }

  $keepBlobs = $uniqueUpToKeepPlusOne | Select-Object -First $Keep
  $fallbackBlob = $keepBlobs[$keepBlobs.Count - 1]

  if (-not $SkipBackup) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupRoot = Join-Path (Split-Path $repoFullPath -Parent) "backups"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupPath = Join-Path $backupRoot ("$(Split-Path $repoFullPath -Leaf)-mirror-$timestamp.git")
    & git clone --mirror $repoFullPath $backupPath | Out-Host
    Write-Host "Mirror backup: $backupPath"
  }

  $pyKeepLines = $keepBlobs | ForEach-Object { "    b`"$_`"," }
  $callbackBody = @"
KEEP_BLOBS = {
$($pyKeepLines -join "`n")
}
FALLBACK = b"$fallbackBlob"

if filename == b"$normalizedPath" and blob_id not in KEEP_BLOBS:
    fb = value.data.get("fallback_blob_id")
    if not fb:
        fb_contents = value.get_contents_by_identifier(FALLBACK)
        fb = value.insert_file_with_contents(fb_contents)
        value.data["fallback_blob_id"] = fb
    return (filename, mode, fb)

return (filename, mode, blob_id)
"@

  $timestamp2 = Get-Date -Format "yyyyMMdd-HHmmss"
  $callbackPath = Join-Path $env:TEMP "filter_repo_prune_db_$timestamp2.py"
  [System.IO.File]::WriteAllText($callbackPath, $callbackBody, (New-Object System.Text.UTF8Encoding($false)))

  Invoke-Git @("filter-repo", "--force", "--file-info-callback", $callbackPath) | Out-Host
  Invoke-Git @("reflog", "expire", "--expire=now", "--all") | Out-Host
  Invoke-Git @("gc", "--prune=now") | Out-Host

  if ($remoteUrl) {
    $remotes = Invoke-Git @("remote") -AllowFailure
    $hasRemote = ($remotes -split "`n" | Where-Object { $_ -eq $Remote }).Count -gt 0
    if (-not $hasRemote) {
      Invoke-Git @("remote", "add", $Remote, $remoteUrl) | Out-Host
    }
  }

  $postUniqueUpToKeepPlusOne = Get-UniqueBlobs -FilePath $normalizedPath -MaxUniqueToReturn ($Keep + 1)
  if ($postUniqueUpToKeepPlusOne.Count -gt $Keep) {
    throw "Unexpected result: '$normalizedPath' still has >$Keep unique versions after rewrite."
  }

  Write-Host "Cleanup complete: '$normalizedPath' now has $($postUniqueUpToKeepPlusOne.Count) unique version(s) in history."

  if ($Push) {
    Invoke-Git @("fetch", $Remote, "--prune") | Out-Host
    Invoke-Git @("push", "--force-with-lease", "--all", $Remote) | Out-Host
    Invoke-Git @("push", "--force-with-lease", "--tags", $Remote) | Out-Host
  }
}
finally {
  Pop-Location
}
