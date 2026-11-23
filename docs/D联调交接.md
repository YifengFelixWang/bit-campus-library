# 给 D 的 C 模块联调交接

当前 D 的 `database/opengauss/dist/library.sql` 已包含下列 C 过程、触发器和授权，可直接在空库恢复。使用旧基线的开发库可按[重建说明](../database/opengauss/README.md)补齐缺失对象。

## 过程签名

- loan.sp_borrow_copy(BIGINT user_id, BIGINT copy_id, INTEGER days, VARCHAR request_no, BIGINT new_loan_id)
- loan.sp_return_copy(BIGINT loan_id, VARCHAR request_no)

借阅多一个 new_loan_id 参数，落实“编号由 C 服务生成”；不能继续执行原 roles/003_execute_grants.sql 中四参数借阅的注释示例。准确授权语句已放在 C 的 004_execute_grants.sql。过程不提交事务，由调用方控制。

request_dedup.user_id 用于记录操作者；馆员代借的目标读者保存在 loan_record.user_id。审计操作人由 session_user 推导。days 不新增列，通过借阅单的期限核对重试参数。请求号为全局 UUID 字符串，不是“每用户独立”的键。

## 报表增量读取

GET /api/internal/loans/changes?afterTime=1970-01-01T00:00:00&afterId=0&limit=100
身份：A 验证的 sync-bot，普通读者、馆员不能调用。
返回：
```json
{"items":[{"loan_id":6,"user_id":2,"copy_id":4,"book_id":4,"status":"RETURNED","borrowed_at":"2026-06-01T10:00:00","due_at":"2026-06-30T10:00:00","returned_at":"2026-06-20T10:00:00","updated_at":"2026-06-20T10:00:00","deleted":false}],"nextCursor":{"afterTime":"2026-06-20T10:00:00","afterId":6},"hasMore":false}
```

items 与 loan_record 列一致，包括 deleted=true 的记录。用 (updated_at,loan_id) 升序、严格大于上一游标分页。时间按数据库 TIMESTAMP 的本地墙钟时间传输，约定 Asia/Shanghai，不加 Z；保留微秒。limit 范围 1–500。空页返回原游标；hasMore=true 时继续读取，最后一页刚好满页可能还需请求一次空页。

D 将 updated_at 写入 loan_fact.source_updated_at；按 loan_id 幂等更新，成功提交本页投影后才推进 sync_checkpoint。不能用“服务收到请求的时间”代替游标。

当前没有删除借阅单的产品接口，正常借还均 deleted=false；变更读取支持 D 定义的删除标志。将来增加删除入口时也必须取得同一写锁并更新 updated_at。

