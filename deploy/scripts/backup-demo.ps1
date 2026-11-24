#requires -Version 7.0
<#
发起一次备份并等待结束。
示例：
  .\backup-demo.ps1 -OperatorPassword 123456789000 -Note "演示库备份"
#>
param(
    [Parameter(Mandatory = $true)][string]$OperatorPassword,
    [string]$OperatorUser = "ops1",
    [string]$Note = "命令行演示备份",
    [string]$BaseUrl = "http://127.0.0.1:18085",
    [string]$IdentityBase = "http://127.0.0.1:8081"
)

. "$PSScriptRoot\OpsClient.ps1" -BaseUrl $BaseUrl -IdentityBase $IdentityBase
$token = Get-OpsToken -Username $OperatorUser -Password $OperatorPassword

$status = Invoke-Ops -Method GET -Path "/api/ops/status" -Token $token
Write-Host ("数据库：{0} / {1}，可达：{2}" -f `
        $status.data.database.database, $status.data.database.databaseUser, $status.data.database.reachable)
if (-not $status.data.database.reachable) {
    Write-Warning ("状态接口报告数据库不可达：{0}" -f $status.data.database.error)
}

$created = Invoke-Ops -Method POST -Path "/api/ops/backups" -Token $token -Body @{ note = $Note }
Write-Host ("已提交备份任务：{0}" -f $created.data.id) -ForegroundColor Cyan
$task = Wait-OpsTask -TaskId $created.data.id -Token $token
Write-OpsResult -Task $task
