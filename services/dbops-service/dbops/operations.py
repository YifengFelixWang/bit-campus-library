"""固定动作实现：备份、恢复验证、主备切换。

每个动作只能由 TaskManager 以受限参数调用；这里不接收任意 shell 字符串。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Config
from .executor import ExecResult, Executor, ExecutorError
from .status import StatusCollector, parse_gs_ctl_query, _role_of
from .tasks import TaskStore

TARGET_DB_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class OperationError(RuntimeError):
    """可以直接展示给运维人员的业务错误。"""


class Operations:
    def __init__(self, config: Config, executor: Executor, store: TaskStore,
                 status: StatusCollector) -> None:
        self.config = config
        self.executor = executor
        self.store = store
        self.status = status

    # ---------------------------------------------------------------- 日志
    def _step(self, task_id: str, index: int, status: str, detail: str = "") -> None:
        self.store.finish_step(task_id, index, status, self.executor.mask(detail))
        self.store.append_log(task_id, "[%s] %s %s" % (
            self.config.iso(), status, self.store.get(task_id)["steps"][index]["name"]))

    def _require_ok(self, result: ExecResult, stage: str) -> None:
        if result.ok:
            return
        detail = result.tail(1200) or "命令失败，退出码 %s" % result.returncode
        raise OperationError("%s失败：%s" % (stage, self.executor.mask(detail)))

    # ---------------------------------------------------------------- 备份
    def list_backups(self) -> list[dict[str, Any]]:
        self.config.backup_dir.mkdir(parents=True, exist_ok=True)
        items: list[dict[str, Any]] = []
        for path in sorted(self.config.backup_dir.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True):
            meta_path = path.with_suffix(".dump.json")
            meta: dict[str, Any] = {}
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    meta = {}
            stat = path.stat()
            items.append({
                "backupId": path.name,
                "fileName": path.name,
                "sizeBytes": stat.st_size,
                "createdAt": meta.get("createdAt") or datetime.fromtimestamp(stat.st_mtime, self.config.tz).isoformat(timespec="seconds"),
                "note": meta.get("note") or "",
                "sha256": meta.get("sha256") or "",
                "taskId": meta.get("taskId") or "",
                "database": meta.get("database") or self.config.db_name,
                "format": meta.get("format") or "custom",
            })
        return items

    def _write_meta(self, path: Path, meta: dict[str, Any]) -> None:
        temp = path.with_suffix(".dump.json.tmp")
        temp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path.with_suffix(".dump.json"))

    def _prune_backups(self) -> list[str]:
        if self.config.retain_backups <= 0:
            return []
        files = sorted(self.config.backup_dir.glob("*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
        removed: list[str] = []
        for path in files[self.config.retain_backups:]:
            try:
                path.unlink()
                sidecar = path.with_suffix(".dump.json")
                if sidecar.exists():
                    sidecar.unlink()
                removed.append(path.name)
            except OSError:
                continue
        return removed

    def backup(self, task_id: str, actor: str, params: dict[str, Any]) -> dict[str, Any]:
        note = str(params.get("note") or "").strip()[:120]
        self.config.backup_dir.mkdir(parents=True, exist_ok=True)
        primary = self._primary_container()

        index = self.store.add_step(task_id, "检查数据库连接")
        check = self.executor.gsql("select 1", container=primary, timeout=10)
        if not check.ok:
            self._step(task_id, index, "FAILED", check.tail(600))
            self._require_ok(check, "数据库连接检查")
        self._step(task_id, index, "SUCCEEDED", "数据库可连接")

        index = self.store.add_step(task_id, "导出数据库归档（gs_dump -F c）")
        stamp = self.config.now().strftime("%Y%m%d-%H%M%S")
        short = secrets.token_hex(2)
        file_name = "%s-%s-%s.dump" % (self.config.db_name, stamp, short)
        local_path = self.config.backup_dir / file_name
        remote_path = "/tmp/ops-%s.dump" % task_id if self.config.exec_mode == "docker" else str(local_path)
        dump = self.executor.gs_dump(remote_path, container=primary)
        if not dump.ok:
            self._step(task_id, index, "FAILED", dump.tail(1200))
            self._require_ok(dump, "gs_dump 导出")
        self._step(task_id, index, "SUCCEEDED", "归档已生成，耗时 %d ms" % dump.duration_ms)

        index = self.store.add_step(task_id, "取回归档文件")
        if self.config.exec_mode == "docker":
            copy = self.executor.copy_from_container(primary, remote_path, str(local_path))
            if not copy.ok:
                self._step(task_id, index, "FAILED", copy.tail(800))
                self._require_ok(copy, "归档文件取回")
            self.executor.in_container(primary, ["rm", "-f", remote_path], timeout=10)
        else:
            local_path = Path(remote_path)
        if not local_path.exists() or local_path.stat().st_size <= 0:
            self._step(task_id, index, "FAILED", "归档文件为空或不存在")
            raise OperationError("归档文件为空或不存在")
        self._step(task_id, index, "SUCCEEDED", "文件 %s" % local_path.name)

        index = self.store.add_step(task_id, "校验归档并登记清单")
        digest = sha256_file(local_path)
        meta = {
            "backupId": local_path.name,
            "fileName": local_path.name,
            "database": self.config.db_name,
            "format": "custom",
            "source": "gs_dump",
            "sizeBytes": local_path.stat().st_size,
            "sha256": digest,
            "note": note,
            "taskId": task_id,
            "actor": actor,
            "createdAt": self.config.iso(),
        }
        self._write_meta(local_path, meta)
        removed = self._prune_backups()
        self._step(task_id, index, "SUCCEEDED", "SHA-256 %s" % digest[:16])

        return {
            "backupId": local_path.name,
            "fileName": local_path.name,
            "sizeBytes": meta["sizeBytes"],
            "sha256": digest,
            "note": note,
            "database": self.config.db_name,
            "createdAt": meta["createdAt"],
            "retentionRemoved": removed,
        }

    # ---------------------------------------------------------------- 恢复
    def _validate_target(self, target: str) -> str:
        target = target.strip()
        if not TARGET_DB_PATTERN.fullmatch(target):
            raise OperationError("目标库名只能包含字母、数字和下划线")
        if target.lower() == self.config.db_name.lower() and not self.config.allow_production_restore:
            raise OperationError("默认不允许覆盖业务库 %s；请恢复到验证库" % self.config.db_name)
        if not self.config.allow_production_restore and not target.startswith(self.config.verify_db_prefix):
            raise OperationError("恢复目标必须是以 %s 开头的验证库" % self.config.verify_db_prefix)
        return target

    def _database_exists(self, target: str, container: str) -> bool:
        sql = "select count(*) from pg_database where datname = '%s'" % target
        result = self.executor.gsql(sql, container=container, database="postgres", timeout=10)
        if not result.ok:
            raise OperationError("查询目标库失败：%s" % result.tail(500))
        try:
            return int(result.stdout.strip().splitlines()[-1]) > 0
        except (ValueError, IndexError):
            raise OperationError("查询目标库返回无法解析：%s" % result.stdout.strip()[:200])

    def _drop_database(self, target: str, container: str) -> None:
        self.executor.gsql(
            "select count(*) from (select pg_terminate_backend(pid) from pg_stat_activity "
            "where datname = '%s' and pid <> pg_backend_pid()) t" % target,
            container=container, database="postgres", timeout=15,
        )
        drop = self.executor.gsql('drop database "%s"' % target, container=container,
                                  database="postgres", timeout=20)
        if not drop.ok:
            raise OperationError("删除旧验证库失败：%s" % drop.tail(800))

    def _create_database(self, target: str, container: str) -> None:
        create = self.executor.gsql('create database "%s"' % target, container=container,
                                    database="postgres", timeout=30)
        if not create.ok:
            raise OperationError("创建验证库失败：%s" % create.tail(800))

    def _object_check(self, target: str, container: str) -> dict[str, Any]:
        checks = [
            ("schemas", "select count(*) from pg_namespace where nspname in ('iam','catalog','loan','report')", 4),
            ("loanIndexes",
             "select count(*) from pg_indexes where schemaname='loan' and indexname in ('idx_loan_user_status','idx_copy_book')", 2),
            ("reportIndexes",
             "select count(*) from pg_indexes where schemaname='report' and indexname in "
             "('idx_book_dim_category','idx_loan_fact_time_status','idx_loan_fact_book','idx_loan_fact_user')", 4),
            ("procedures",
             "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
             "where n.nspname='loan' and p.proname in ('sp_borrow_copy','sp_return_copy')", 2),
            ("auditTrigger",
             "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid "
             "join pg_namespace n on n.oid=c.relnamespace "
             "where not t.tgisinternal and n.nspname='loan' and t.tgname='loan_audit_trigger'", 1),
            ("loanRecords", "select count(*) from loan.loan_record", None),
            ("books", "select count(*) from catalog.book", None),
            ("users", "select count(*) from iam.app_user", None),
        ]
        summary: dict[str, Any] = {}
        passed = True
        for key, sql, expected in checks:
            result = self.executor.gsql(sql, container=container, database=target, timeout=15)
            if not result.ok:
                summary[key] = {"actual": None, "expected": expected, "ok": False,
                                "error": self.executor.mask(result.tail(300))}
                passed = False
                continue
            try:
                actual = int(result.stdout.strip().splitlines()[-1])
            except (ValueError, IndexError):
                summary[key] = {"actual": None, "expected": expected, "ok": False, "error": "无法解析"}
                passed = False
                continue
            ok = expected is None or actual == expected
            summary[key] = {"actual": actual, "expected": expected, "ok": ok}
            if not ok:
                passed = False
        return {"passed": passed, "items": summary}

    def restore(self, task_id: str, actor: str, params: dict[str, Any]) -> dict[str, Any]:
        backup_id = str(params.get("backupId") or "").strip()
        target = self._validate_target(str(params.get("targetDatabase") or self.config.verify_db_prefix))
        if not self.executor.safe_file_name(backup_id):
            raise OperationError("备份文件名不合法")
        source = self.config.backup_dir / backup_id
        if not source.exists():
            raise OperationError("找不到备份文件 %s" % backup_id)
        primary = self._primary_container()

        index = self.store.add_step(task_id, "校验备份与目标库")
        digest = sha256_file(source)
        self._step(task_id, index, "SUCCEEDED", "%s，%d 字节，目标库 %s" % (backup_id, source.stat().st_size, target))

        index = self.store.add_step(task_id, "重建空验证库")
        existed = self._database_exists(target, primary)
        if existed:
            self._drop_database(target, primary)
        self._create_database(target, primary)
        self._step(task_id, index, "SUCCEEDED", "%s %s" % ("已删除并重建" if existed else "已创建", target))

        index = self.store.add_step(task_id, "恢复归档到验证库（gs_restore）")
        remote_path = "/tmp/ops-restore-%s.dump" % task_id
        if self.config.exec_mode == "docker":
            upload = self.executor.copy_to_container(str(source), primary, remote_path)
            if not upload.ok:
                self._step(task_id, index, "FAILED", upload.tail(600))
                self._require_ok(upload, "归档上传")
        else:
            remote_path = str(source)
        restore = self.executor.gs_restore(remote_path, target, container=primary)
        if self.config.exec_mode == "docker":
            self.executor.in_container(primary, ["rm", "-f", remote_path], timeout=10)
        if not restore.ok:
            self._step(task_id, index, "FAILED", restore.tail(1500))
            raise OperationError("gs_restore 失败：%s" % self.executor.mask(restore.tail(800)))
        self._step(task_id, index, "SUCCEEDED", "耗时 %d ms" % restore.duration_ms)

        index = self.store.add_step(task_id, "核对关键对象")
        object_check = self._object_check(target, primary)
        checklist_output = ""
        if self.config.checklist_sql.exists():
            remote_sql = "/tmp/ops-checklist-%s.sql" % task_id
            if self.config.exec_mode == "docker":
                upload = self.executor.copy_to_container(str(self.config.checklist_sql), primary, remote_sql)
                if upload.ok:
                    run = self.executor.gsql_file(remote_sql, container=primary, database=target, timeout=60)
                    checklist_output = self.executor.mask(run.stdout + "\n" + run.stderr)[-8000:]
                    self.executor.in_container(primary, ["rm", "-f", remote_sql], timeout=10)
            else:
                run = self.executor.gsql_file(str(self.config.checklist_sql), container=primary,
                                             database=target, timeout=60)
                checklist_output = self.executor.mask(run.stdout + "\n" + run.stderr)[-8000:]
        if checklist_output:
            self.store.append_log(task_id, "对象核对清单输出：\n" + checklist_output)
        if not object_check["passed"]:
            self._step(task_id, index, "FAILED", "关键对象计数与预期不符，见任务结果")
            raise OperationError("恢复后的关键对象与预期不符")
        self._step(task_id, index, "SUCCEEDED", "八个核对项全部通过")

        return {
            "backupId": backup_id,
            "targetDatabase": target,
            "sha256": digest,
            "durationMs": restore.duration_ms,
            "objectCheck": object_check,
            "checklistOutput": checklist_output[-4000:],
            "database": self.config.db_name,
        }

    # ---------------------------------------------------------------- 切换
    def _roles(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for container in [self.config.db_container, self.config.standby_container]:
            if not container:
                continue
            if self.config.exec_mode == "docker":
                running, _ = self.executor.container_running(container)
                if not running:
                    result[container] = "offline"
                    continue
            query = self.executor.gs_ctl("query", container, timeout=15)
            if not query.ok:
                result[container] = "unknown"
                continue
            result[container] = _role_of(parse_gs_ctl_query(query.stdout))
        return result

    def _roles_fast(self) -> dict[str, str]:
        """用 pg_is_in_recovery() 快速判断角色，避免切换后 gs_ctl query 长时间等待。"""
        result: dict[str, str] = {}
        sql = "select case when pg_is_in_recovery() then 'standby' else 'primary' end"
        for container in [self.config.db_container, self.config.standby_container]:
            if not container:
                continue
            try:
                probe = self.executor.gsql(sql, container=container, database="postgres", timeout=8)
            except Exception:
                result[container] = "unknown"
                continue
            if not probe.ok:
                result[container] = "unknown"
                continue
            lines = [line.strip().lower() for line in probe.stdout.splitlines() if line.strip()]
            result[container] = lines[-1] if lines else "unknown"
        return result

    def _primary_container(self) -> str:
        """当前主节点容器（local 模式下为数据目录）。单实例直接用 OPS_DB_CONTAINER。"""
        if not self.config.standby_container:
            return self.config.db_container
        roles = self._roles()
        for container, role in roles.items():
            if role == "primary":
                return container
        return self.config.db_container

    def switchover(self, task_id: str, actor: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.config.standby_container:
            raise OperationError("未配置备节点容器 OPS_STANDBY_CONTAINER，无法执行主备切换")
        if params.get("confirm") is not True:
            raise OperationError("切换前必须在页面确认目标环境")

        index = self.store.add_step(task_id, "确认切换前主备角色")
        before = self._roles()
        primary = [name for name, role in before.items() if role == "primary"]
        standby = [name for name, role in before.items() if role == "standby"]
        if len(primary) != 1 or len(standby) != 1:
            self._step(task_id, index, "FAILED", "角色不符合一主一备：%s" % before)
            raise OperationError("当前不是一主一备状态，不能做计划内切换：%s" % before)
        self._step(task_id, index, "SUCCEEDED", "主 %s / 备 %s" % (primary[0], standby[0]))

        cmd_index = self.store.add_step(task_id, "在备节点执行 gs_ctl switchover")
        started = time.monotonic()
        result = self.executor.gs_ctl("switchover", standby[0],
                                      extra=["-t", str(self.config.switchover_timeout)],
                                      timeout=self.config.switchover_timeout + 30)
        self.store.append_log(task_id, self.executor.mask(result.stdout + "\n" + result.stderr))
        if not result.ok:
            # 返回码非零不等于切换失败：以轮询到的真实角色为准，避免误报
            self.store.append_log(task_id, "gs_ctl 返回码 %s，继续核对实际角色" % result.returncode)
            self._step(task_id, cmd_index, "RUNNING", "返回码 %s，等待角色核对" % result.returncode)
        else:
            self._step(task_id, cmd_index, "SUCCEEDED", "命令返回，耗时 %d ms" % result.duration_ms)

        index = self.store.add_step(task_id, "等待并核对角色互换")
        deadline = time.monotonic() + self.config.switchover_timeout
        after = before
        while time.monotonic() < deadline:
            time.sleep(2)
            after = self._roles()
            if after.get(self.config.standby_container) == "primary" and after.get(self.config.db_container) == "standby":
                break
        swapped = after.get(standby[0]) == "primary" and after.get(primary[0]) == "standby"
        if not swapped:
            self._step(task_id, cmd_index, "FAILED", "命令返回后角色未互换")
            self._step(task_id, index, "FAILED", "超时仍未完成角色互换：%s" % after)
            raise OperationError("切换超时，实际角色：%s" % after)
        elapsed = round(time.monotonic() - started, 1)
        if not result.ok:
            self._step(task_id, cmd_index, "SUCCEEDED", "返回码非零，但角色已实际互换")
        self._step(task_id, index, "SUCCEEDED", "角色已互换，耗时 %.1f 秒" % elapsed)

        index = self.store.add_step(task_id, "验证新主节点可写")
        probe = self.executor.gsql(
            "create temp table ops_write_probe(x int); "
            "insert into ops_write_probe values (1); "
            "drop table ops_write_probe",
            container=standby[0], timeout=20,
        )
        if not probe.ok:
            self._step(task_id, index, "FAILED", probe.tail(800))
            raise OperationError("新主节点写入验证失败：%s" % self.executor.mask(probe.tail(600)))
        self._step(task_id, index, "SUCCEEDED", "临时表写入成功")

        return {
            "before": before,
            "after": after,
            "switchoverSeconds": elapsed,
            "newPrimary": standby[0],
            "newStandby": primary[0],
            "writable": True,
        }
