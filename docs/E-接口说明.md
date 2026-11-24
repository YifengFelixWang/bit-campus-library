# dbops-service 接口说明（给 A / B / C / D 联调用）

基础地址：本机 `http://127.0.0.1:18085`，页面经 Nginx 走 `http://127.0.0.1:8080/api/ops/`。所有响应统一为：

```json
{ "code": "OK", "message": "", "data": { } }
```

失败时 `code` 是 `UNAUTHORIZED` / `FORBIDDEN` / `CONFLICT` / `EXECUTOR_UNAVAILABLE` / `BAD_REQUEST` / `INTERNAL_ERROR`，`message` 是给页面直接展示的中文。

## 鉴权

- 请求头 `Authorization: Bearer <identity-service 登录返回的 accessToken>`；
- 服务端拿这个令牌调 identity-service 的 `/users/me`，取 `username` 与 `roles`；
- 角色含 `OPERATOR` 才能做写操作；`GET /status` 只要求已登录；
- `/health` 不需要令牌。

| 场景 | 状态码 |
| --- | --- |
| 无令牌/令牌无效 | 401 |
| 已登录但角色不是 `OPERATOR` | 403 |
| 身份服务不可达 | 503 |

## 接口清单

### GET `/api/ops/health`

探活，不需要令牌。

```json
{ "code": "OK", "data": { "status": "UP", "service": "dbops-service", "version": "1.0.0", "tasks": 12 } }
```

### GET `/api/ops/status`

查询节点、复制与数据库状态。可选 `?refresh=1` 跳过 5 秒缓存。

```json
{
  "code": "OK",
  "data": {
    "nodes": [
      { "name": "node-a", "role": "primary", "dbState": "Normal", "host": "127.0.0.1", "port": 15432, "container": "library-opengauss-a", "reachable": true },
      { "name": "node-b", "role": "standby", "dbState": "Normal", "host": "127.0.0.1", "port": 15433, "container": "library-opengauss-b", "reachable": true }
    ],
    "primary": { "name": "node-a", "port": 15432, "container": "library-opengauss-a" },
    "standby": { "name": "node-b", "port": 15433, "container": "library-opengauss-b" },
    "replication": { "configured": true, "state": "STREAMING", "lagSeconds": 0 },
    "database": { "name": "library", "reachable": true, "error": "", "checkedAt": "2026-11-23T10:00:00+08:00" },
    "collectedAt": "2026-11-23T10:00:01+08:00",
    "viewer": { "username": "ops1", "roles": ["OPERATOR"] }
  }
}
```

单实例：`node-b` / `standby` 为 `null`，`replication.state=SINGLE`。

### GET `/api/ops/backups`

需要 `OPERATOR`。列出 `OPS_BACKUP_DIR` 里的归档与清单。

```json
{
  "code": "OK",
  "data": {
    "items": [
      { "id": "library-20261123-100000.dump", "sizeBytes": 18321408, "createdAt": "2026-11-23T10:00:05+08:00", "note": "切换前基线", "sha256": "9f2c...", "source": "library" }
    ],
    "totalBytes": 18321408,
    "backupDir": "/backup"
  }
}
```

### POST `/api/ops/backups`

需要 `OPERATOR`。提交异步任务，立即返回 202 与任务对象。

```json
{ "note": "切换前基线" }
```

```json
{ "code": "OK", "data": { "id": "t-20261123-100000-ab12", "type": "backup", "status": "QUEUED", "actor": "ops1", "params": { "note": "切换前基线" }, "steps": [], "createdAt": "..." } }
```

### GET `/api/ops/tasks?limit=20`

需要 `OPERATOR`，返回最近任务摘要（按创建时间倒序）。

### GET `/api/ops/tasks/{id}`

需要 `OPERATOR`。任务不存在返回 409（`CONFLICT`，消息“任务不存在”）。

任务对象关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `type` | `backup` / `restore` / `switchover` |
| `status` | `QUEUED` / `RUNNING` / `SUCCEEDED` / `FAILED` |
| `actor` | 提交人 |
| `params` | 请求参数 |
| `steps[]` | `{name, status, detail, startedAt, finishedAt}` |
| `result` | 成功时的结果，随类型不同 |
| `error` | 失败原因（已脱敏） |
| `createdAt` / `startedAt` / `finishedAt` | 时间 |

### POST `/api/ops/restores`

需要 `OPERATOR`。`confirm` 必须为 `true`。

```json
{ "backupId": "library-20261123-100000.dump", "targetDatabase": "library_verify_1123", "confirm": true }
```

约束：

- `backupId` 必须是 `OPS_BACKUP_DIR` 下真实存在的文件名；
- `targetDatabase` 必须以 `library_verify` 开头；
- 目标库存在时先终止连接、删除、重建（只动验证库）。

结果 `data.result`：

```json
{
  "backupId": "library-20261123-100000.dump",
  "targetDatabase": "library_verify_1123",
  "sha256": "9f2c...",
  "durationMs": 4210,
  "objectCheck": {
    "passed": true,
    "items": {
      "schemas": { "actual": 4, "expected": 4, "ok": true },
      "loanIndexes": { "actual": 2, "expected": 2, "ok": true }
    }
  }
}
```

### POST `/api/ops/switchover`

需要 `OPERATOR`。`confirm` 必须为 `true`；要求一主一备且状态正常。

```json
{ "confirm": true }
```

结果包含切换前后角色、`gs_ctl` 耗时、新主可写探测结果。

## 页面如何使用

| 页面动作 | 调用 |
| --- | --- |
| 进入控制台 | `GET /status`，之后 10 秒轮询 |
| 备份列表 | `GET /backups` |
| 创建备份 | `POST /backups`，然后轮询 `GET /tasks/{id}` |
| 恢复 | `POST /restores`，轮询任务 |
| 切换 | `POST /switchover`，轮询任务 |
| 历史 | `GET /tasks?limit=20` |

前端封装在 `web/src/services/api.js`：`opsStatus`、`opsBackups`、`opsCreateBackup`、`opsTasks`、`opsTask`、`opsRestore`、`opsSwitchover`。

## 联调注意

- C 的借还服务如果要指向 `library_verify_*` 做验证，改 `LOAN_DB_NAME` 或 JDBC URL 后重启，验证完切回 `library`；
- D 的对象核对 SQL 挂载在 `/opt/dbops/sql/15-对象核对清单.sql`，恢复任务会自动执行并把输出写进任务日志；
- 备份/恢复/切换串行执行，同一时间只有一个任务处于 `RUNNING`，其余排队；
- 任务记录落在 `OPS_TASK_DIR`，业务库恢复不会清掉运维历史。
