param(
    [switch]$InitReaders,
    [switch]$Build,
    [string]$JdkHome,
    [string]$Maven = 'mvn',
    [string]$EnvFile
)
$ErrorActionPreference = 'Stop'
$service = Join-Path $PSScriptRoot 'services/identity-service'
$toolsDir = Join-Path (Split-Path $PSScriptRoot) '.tools'
if (!$JdkHome) {
    $portable = Get-ChildItem -LiteralPath $toolsDir -Directory -Filter 'zulu21*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $JdkHome = if ($portable) { $portable.FullName } else { $env:JAVA_HOME }
}
if ($JdkHome) {
    $env:JAVA_HOME = $JdkHome
    $env:Path = (Join-Path $JdkHome 'bin') + [IO.Path]::PathSeparator + $env:Path
}
if (!$env:IAM_DB_PASSWORD) {
    $password = $env:LIBRARY_LOCAL_PASSWORD
    if (!$password) {
        if (!$EnvFile) {
            $EnvFile = @('.env', 'database/opengauss/.env', '../../D-数据库设计/env.example') |
                ForEach-Object { Join-Path $PSScriptRoot $_ } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        }
        if ($EnvFile) {
            $line = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match '^LIBRARY_LOCAL_PASSWORD=' } | Select-Object -First 1
            if ($line) { $password = ($line -split '=', 2)[1].Trim() -replace '^"(.*)"$|^''(.*)''$', '$1$2' }
        }
    }
    if ([string]::IsNullOrWhiteSpace($password)) { throw 'Set IAM_DB_PASSWORD or fill LIBRARY_LOCAL_PASSWORD in database/opengauss/.env.' }
    $env:IAM_DB_PASSWORD = $password
}
if ($InitReaders) {
    foreach ($reader in @('reader01', 'reader02')) {
        $key = 'IAM_SEED_' + $reader.ToUpperInvariant() + '_PASSWORD'
        if (![Environment]::GetEnvironmentVariable($key, 'Process')) {
            $secret = Read-Host "Set an application password for ${reader} (at least 12 characters)" -AsSecureString
            if ($secret.Length -lt 12) { throw 'Reader password must contain at least 12 characters.' }
            [Environment]::SetEnvironmentVariable($key, ([Net.NetworkCredential]::new('', $secret)).Password, 'Process')
        }
    }
}
$jar = Join-Path $service 'target/identity-service-1.0.0.jar'
if ($Build -or !(Test-Path -LiteralPath $jar)) {
    $arguments = @('-f', (Join-Path $service 'pom.xml'), 'package')
    $cache = Join-Path $toolsDir 'm2'
    if (Test-Path -LiteralPath $cache) { $arguments = @("-Dmaven.repo.local=$cache") + $arguments }
    & $Maven @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Identity service build failed.' }
}
& java -jar $jar
if ($LASTEXITCODE -ne 0) { throw 'Identity service stopped with a non-zero exit code.' }
