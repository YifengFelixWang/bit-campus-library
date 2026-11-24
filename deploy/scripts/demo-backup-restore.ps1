#requires -Version 7.0
<#
今天的验收链路（需要在装有 Docker 的机器上运行）：
  1. 从正在运行的演示库备份；
  2. 在演示库改一本书的书名（模拟业务写入）；
  3. 把备份恢复到 library_verify；
  4. 对比验证库仍是旧书名、演示库是新书名。

示例：
  .\demo-backup-restore.ps1 -OperatorPassword 123456789000 -DbPassword 123456789000 -ChangeTitle
#>
param(
    [Parameter(Mandatory = $true)][string]$OperatorPassword,
    [string]$OperatorUser = "ops1",
    [Parameter(Mandatory = $true)][string]$DbPassword,
    [string]$DbUser = "gaussdb",
    [string]$DbContainer = "library-opengauss",
    [string]$DbOsUser = "omm",
    [string]$TargetDatabase = "library_verify",
    [switch]$ChangeTitle,
    [string]$BaseUrl = "http://127.0.0.1:18085",
    [string]$IdentityBase = "http://127.0.0.1:8081"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\OpsClient.ps1" -BaseUrl $BaseUrl -IdentityBase $IdentityBase

function Invoke-Gsql {
    param([string]$Database, [string]$Sql)
    $args = @("exec")
    if ($DbOsUser) { $args += @("-u", $DbOsUser) }
    $args += @($DbContainer, "gsql", "-U", $DbUser, "-W", $DbPassword, "-p", "5432",
        "-d", $Database, "-t", "-A", "-c", $Sql)
    $output = & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gsql 执行失败（库 $Database）：$output"
    }
    return (($output | Out-String).Trim())
}

$token = Get-OpsToken -Username $OperatorUser -Password $OperatorPassword

Write-Host "[1/6] 读取演示库第一本书" -ForegroundColor Cyan
$row = Invoke-Gsql -Database "library" -Sql "select isbn || '|' || title from catalog.book order by book_id limit 1"
if (-not $row) { throw "catalog.book 里没有数据，无法做演示" }
$parts = $row.Split("|", 2)
$isbn = $parts[0].Trim()
$originalTitle = $parts[1].Trim()
Write-Host ("  ISBN={0} 原书名={1}" -f $isbn, $originalTitle)

Write-Host "[2/6] 创建备份（改动之前）" -ForegroundColor Cyan
$created = Invoke-Ops -Method POST -Path "/api/ops/backups" -Token $token -Body @{ note = "E 验收：改动前备份" }
$backupTask = Wait-OpsTask -TaskId $created.data.id -Token $token
if ($backupTask.status -ne "SUCCEEDED") { Write-OpsResult -Task $backupTask; throw "备份失败，停止演示" }
$backupId = $backupTask.result.backupId
Write-Host ("  备份完成：{0}，{1} 字节，SHA-256 {2}" -f $backupId, $backupTask.result.sizeBytes, $backupTask.result.sha256)

$newTitle = "$originalTitle（E备份演练改动）"
if ($ChangeTitle) {
    Write-Host "[3/6] 在演示库修改书名，模拟备份之后的业务写入" -ForegroundColor Cyan
    $escapedNew = $newTitle.Replace("'", "''")
    Invoke-Gsql -Database "library" -Sql "update catalog.book set title = '$escapedNew' where isbn = '$isbn'" | Out-Null
    $demoNow = Invoke-Gsql -Database "library" -Sql "select title from catalog.book where isbn = '$isbn'"
    Write-Host ("  演示库现在：{0}" -f $demoNow)
} else {
    Write-Host "[3/6] 未指定 -ChangeTitle，跳过改书名；恢复后两库应完全一致" -ForegroundColor Yellow
}

Write-Host "[4/6] 把备份恢复到 $TargetDatabase" -ForegroundColor Cyan
$restoreTask = Invoke-Ops -Method POST -Path "/api/ops/restores" -Token $token -Body @{
    backupId       = $backupId
    targetDatabase = $TargetDatabase
    confirm        = $true
}
$restored = Wait-OpsTask -TaskId $restoreTask.data.id -Token $token
Write-OpsResult -Task $restored
if ($restored.status -ne "SUCCEEDED") { throw "恢复失败，见上方任务结果" }

Write-Host "[5/6] 对比两个库中的书名" -ForegroundColor Cyan
$verifyTitle = Invoke-Gsql -Database $TargetDatabase -Sql "select title from catalog.book where isbn = '$isbn'"
$demoAfter = Invoke-Gsql -Database "library" -Sql "select title from catalog.book where isbn = '$isbn'"

$compare = [pscustomobject]@{
    ISBN           = $isbn
    原书名         = $originalTitle
    演示库当前书名 = $demoAfter
    验证库书名     = $verifyTitle
    恢复点对得上   = ($verifyTitle -eq $originalTitle)
}
$compare | Format-List

Write-Host "[6/6] 结论" -ForegroundColor Cyan
if ($ChangeTitle) {
    if ($verifyTitle -eq $originalTitle -and $demoAfter -eq $newTitle) {
        Write-Host "  PASS：验证库回到备份时刻的旧书名，演示库保留备份之后的新书名。" -ForegroundColor Green
        exit 0
    }
} else {
    if ($verifyTitle -eq $originalTitle -and $demoAfter -eq $originalTitle) {
        Write-Host "  PASS：验证库与演示库书名一致，恢复可读。" -ForegroundColor Green
        exit 0
    }
}
Write-Host "  FAIL：书名对比不符合预期，请检查任务日志。" -ForegroundColor Red
exit 1
