Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$pathManagementFlag = '--workspace-installer-manage-user-path'
if ($args.Count -gt 0 -and [string]$args[0] -ceq $pathManagementFlag) {
  try {
    if ($args.Count -ne 3 -or @('install', 'uninstall') -notcontains [string]$args[1]) {
      throw 'Invalid installer PATH management request.'
    }
    $action = [string]$args[1]
    $target = ([string]$args[2]).Trim().TrimEnd('\')
    if ([string]::IsNullOrWhiteSpace($target)) {
      throw 'The installer CLI bin path is empty.'
    }
    $registryKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($null -eq $registryKey -and $action -eq 'install') {
      $registryKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    }
    if ($null -eq $registryKey) {
      exit 0
    }
    try {
      $currentValue = $registryKey.GetValue(
        'Path',
        '',
        [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
      )
      $currentPath = if ($null -eq $currentValue) { '' } else { [string]$currentValue }
      $matchesTarget = {
        param([string]$entry)
        [string]::Equals($entry.Trim().TrimEnd('\'), $target, [StringComparison]::OrdinalIgnoreCase)
      }
      if ($action -eq 'install') {
        if ($currentPath.Split(';') | Where-Object { & $matchesTarget $_ }) {
          exit 0
        }
        $nextPath = if ([string]::IsNullOrEmpty($currentPath)) {
          $target
        } elseif ($currentPath.EndsWith(';', [StringComparison]::Ordinal)) {
          "$currentPath$target"
        } else {
          "$currentPath;$target"
        }
        $registryKey.SetValue('Path', $nextPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
      } else {
        $removed = $false
        $keptEntries = [Collections.Generic.List[string]]::new()
        foreach ($entry in $currentPath.Split(';')) {
          if (& $matchesTarget $entry) {
            $removed = $true
          } else {
            $keptEntries.Add($entry)
          }
        }
        if (-not $removed) {
          exit 0
        }
        $nextPath = [string]::Join(';', $keptEntries)
        if ([string]::IsNullOrEmpty($nextPath)) {
          $registryKey.DeleteValue('Path', $false)
        } else {
          $registryKey.SetValue('Path', $nextPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        }
      }
    } finally {
      $registryKey.Dispose()
    }
    exit 0
  } catch {
    [Console]::Error.Write("workspace installer: $($_.Exception.Message)$([Environment]::NewLine)")
    exit 1
  }
}

$commandArguments = [string[]]@($args)
$requestPath = $null
$responsePath = $null
$temporaryRequestPath = $null
$exitCode = 1

try {
  $appData = $env:APPDATA
  if ([string]::IsNullOrWhiteSpace($appData)) {
    $appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
  }
  if ([string]::IsNullOrWhiteSpace($appData)) {
    throw 'The current user AppData directory could not be resolved.'
  }

  $appPath = if ([string]::IsNullOrWhiteSpace($env:WORKSPACE_CLI_APP)) {
    Join-Path $PSScriptRoot '..\Workspace.exe'
  } else {
    $env:WORKSPACE_CLI_APP
  }
  $appPath = [IO.Path]::GetFullPath($appPath)
  if (-not [IO.File]::Exists($appPath)) {
    throw "Workspace executable was not found at $appPath."
  }

  $stateDirectory = if ([string]::IsNullOrWhiteSpace($env:WORKSPACE_CLI_STATE_DIR)) {
    $uninstallerPath = Join-Path ([IO.Path]::GetDirectoryName($appPath)) 'Uninstall Workspace.exe'
    $stateName = if ([IO.File]::Exists($uninstallerPath)) { 'Workspace' } else { 'Workspace Development' }
    Join-Path $appData $stateName
  } else {
    $env:WORKSPACE_CLI_STATE_DIR
  }
  $stateDirectory = [IO.Path]::GetFullPath($stateDirectory)

  $timeoutMs = 120000
  if (-not [string]::IsNullOrWhiteSpace($env:WORKSPACE_CLI_TIMEOUT_MS)) {
    $configuredTimeout = 0
    if (-not [int]::TryParse($env:WORKSPACE_CLI_TIMEOUT_MS, [ref]$configuredTimeout) -or $configuredTimeout -lt 100 -or $configuredTimeout -gt 600000) {
      throw 'WORKSPACE_CLI_TIMEOUT_MS must be an integer between 100 and 600000.'
    }
    $timeoutMs = $configuredTimeout
  }

  $requestId = [Guid]::NewGuid().ToString('D')
  $cliRoot = Join-Path $stateDirectory 'cli'
  $requestDirectory = Join-Path $cliRoot 'requests'
  $responseDirectory = Join-Path $cliRoot 'responses'
  [IO.Directory]::CreateDirectory($requestDirectory) | Out-Null
  [IO.Directory]::CreateDirectory($responseDirectory) | Out-Null
  $requestPath = Join-Path $requestDirectory "$requestId.json"
  $responsePath = Join-Path $responseDirectory "$requestId.json"
  $temporaryRequestId = [Guid]::NewGuid().ToString('D')
  $temporaryRequestPath = Join-Path $requestDirectory "$requestId.$temporaryRequestId.tmp"

  $request = [ordered]@{
    protocolVersion = 1
    id = $requestId
    argv = $commandArguments
    cwd = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath
    createdAt = [DateTimeOffset]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
  }
  $requestJson = $request | ConvertTo-Json -Compress -Depth 4
  $requestBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($requestJson)
  $requestStream = [IO.FileStream]::new(
    $temporaryRequestPath,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $requestStream.Write($requestBytes, 0, $requestBytes.Length)
    $requestStream.Flush($true)
  } finally {
    $requestStream.Dispose()
  }
  [IO.File]::Move($temporaryRequestPath, $requestPath)
  $temporaryRequestPath = $null

  Start-Process -FilePath $appPath -ArgumentList @('--workspace-cli-request', $requestId) -WindowStyle Hidden | Out-Null

  $timer = [Diagnostics.Stopwatch]::StartNew()
  while (-not [IO.File]::Exists($responsePath)) {
    if ($timer.ElapsedMilliseconds -ge $timeoutMs) {
      throw [TimeoutException]::new("Workspace did not answer CLI request $requestId within $timeoutMs ms.")
    }
    Start-Sleep -Milliseconds 50
  }

  $response = [IO.File]::ReadAllText($responsePath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
  if ($response.protocolVersion -ne 1) {
    throw "Workspace returned unsupported CLI protocol version $($response.protocolVersion)."
  }
  if ([string]$response.id -cne $requestId) {
    throw 'Workspace returned a CLI response with the wrong request id.'
  }
  $exitCode = [Convert]::ToInt32($response.exitCode, [Globalization.CultureInfo]::InvariantCulture)
  [Console]::Out.Write([string]$response.stdout)
  [Console]::Error.Write([string]$response.stderr)
} catch [TimeoutException] {
  $exitCode = 124
  [Console]::Error.Write("workspace: $($_.Exception.Message)$([Environment]::NewLine)")
} catch {
  $exitCode = 1
  [Console]::Error.Write("workspace: $($_.Exception.Message)$([Environment]::NewLine)")
} finally {
  foreach ($path in @($temporaryRequestPath, $requestPath, $responsePath)) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and [IO.File]::Exists($path)) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
  }
}

exit $exitCode
