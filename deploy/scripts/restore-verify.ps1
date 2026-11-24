#requires -Version 7.0
<#
取一份备份恢复到验证库，并打印对象核对结果。
示例：
  .\restore-verify.ps1 -OperatorPassword 123456789000
  .\restore-verify.ps1 -OperatorPassword 123456789000 -BackupId library-20261123-190000-abcd.dump
#>
param(
    [Parameter(Mandatory = $true)][string]$OperatorPassword,
    [string]$OperatorUser = "ops1",
    [string]$BackupId = "",
    [string]$TargetDatabase = "library_verify",
    [string]$BaseUrl = "http://127.0.0.1:18085",
    [string]$IdentityBase = "http://127.0.0.1:8081"
)

. "$PSScriptRoot\OpsClient.ps1" -BaseUrl $BaseUrl -IdentityBase $IdentityBase
$token = Get-OpsToken -Username $OperatorUser -Password $OperatorPassword

$backups = Invoke-Ops -Method GET -Path "/api/ops/backups" -Token $token
$items = @($backups.data.items)
if ($items.Count -eq 0) { throw "没有任何备份，请先执行 backup-demo.ps1" }

if ($BackupId) {
    $selected = $items | Where-Object { $_.backupId -eq $BackupId } | Select-Object -First 1
    if (-not $selected) { throw "备份清单里找不到 $BackupId" }
} else {
    $selected = $items[0]
}
Write-Host ("使用备份：{0}（{1}，{2} 字节）" -f $selected.backupId, $selected.createdAt, $selected.sizeBytes) -ForegroundColor Cyan

$created = Invoke-Ops -Method POST -Path "/api/ops/restores" -Token $token -Body @{
    backupId       = $selected.backupId
    targetDatabase = $TargetDatabase
    confirm        = $true
}
Write-Host ("已提交恢复任务：{0}，目标库：{1}" -f $created.data.id, $TargetDatabase) -ForegroundColor Cyan
$task = Wait-OpsTask -TaskId $created.data.id -Token $token
Write-OpsResult -Task $task
