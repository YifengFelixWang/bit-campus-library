param([string]$JdkHome = '', [string]$Maven = 'mvn', [string]$EnvFile = '', [switch]$UseJar)
$ErrorActionPreference = 'Stop'
if (!$JdkHome) {
    $portableJdk = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\.tools') -Directory -ErrorAction SilentlyContinue | Where-Object Name -Like 'zulu*' | Select-Object -First 1
    $JdkHome = if ($portableJdk) { $portableJdk.FullName } else { $env:JAVA_HOME }
}
if ($Maven -eq 'mvn' -and !(Get-Command mvn -ErrorAction SilentlyContinue)) {
    $bundledMaven = 'D:\IDE\IntelliJ IDEA 2020.2\plugins\maven\lib\maven3\bin\mvn.cmd'
    if (Test-Path -LiteralPath $bundledMaven) { $Maven = $bundledMaven }
}
if ($JdkHome) { $env:JAVA_HOME = $JdkHome; $env:PATH = "$JdkHome\bin;$env:PATH" }
$passwordKeys = @('LOAN_DB_READER01_PASSWORD','LOAN_DB_READER02_PASSWORD','LOAN_DB_LIBRARIAN01_PASSWORD')
$missingKeys = @($passwordKeys | Where-Object { ![Environment]::GetEnvironmentVariable($_) })
if ($missingKeys.Count) {
    $demoPassword = $env:LIBRARY_LOCAL_PASSWORD
    if (!$demoPassword) {
        if (!$EnvFile) {
            $EnvFile = @('.env','database/opengauss/.env','..\..\D-数据库设计\env.example','..\D-数据库设计\env.example') |
                ForEach-Object { Join-Path $PSScriptRoot $_ } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        }
        if (!$EnvFile) { throw '请指定 -EnvFile 或设置 LOAN_DB_*_PASSWORD 环境变量。' }
        $entry = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match '^LIBRARY_LOCAL_PASSWORD=' } | Select-Object -First 1
        if ($entry) { $demoPassword = ($entry -split '=',2)[1].Trim() -replace '^"(.*)"$|^''(.*)''$', '$1$2' }
        if ([string]::IsNullOrWhiteSpace($demoPassword)) { throw '请在 database/opengauss/.env 中填写 LIBRARY_LOCAL_PASSWORD。' }
    }
    foreach ($key in $missingKeys) { [Environment]::SetEnvironmentVariable($key, $demoPassword, 'Process') }
}
if (!$env:LOAN_DB_URL) { $env:LOAN_DB_URL = 'jdbc:opengauss://localhost:15432/library' }
if (!$env:IDENTITY_URL) { $env:IDENTITY_URL = 'http://127.0.0.1:8081/users/me' }
Push-Location (Join-Path $PSScriptRoot 'services\loan-service')
try {
    if ($UseJar) {
        $jar = 'target\loan-service-1.0.0.jar'
        if (!(Test-Path -LiteralPath $jar -PathType Leaf)) { throw '找不到借阅服务 JAR，请先构建或去掉 -UseJar。' }
        & java -jar $jar
    } else { & $Maven spring-boot:run }
    if ($LASTEXITCODE -ne 0) { throw '服务启动失败，请查看上方错误' }
}
finally { Pop-Location }
