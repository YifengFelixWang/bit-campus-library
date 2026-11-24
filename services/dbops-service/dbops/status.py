"""数据库与主备状态采集。

状态只读：通过 gsql / gs_ctl 读取，不修改数据。采集结果缓存数秒，
页面轮询不会把数据库连接打满；采集失败时明确返回 reachable=false 与错误，
不沿用旧值冒充在线。
"""

from __future__ import annotations

import threading
import time
from typing import Any

from .config import Config
from .executor import ExecResult, Executor, ExecutorError


def parse_gs_ctl_query(text: str) -> dict[str, str]:
    """把 gs_ctl query 的 `key : value` 文本转成字典，保留原始键与规范化键。"""
    result: dict[str, str] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().strip("-").strip()
        if not key:
            continue
        result[key] = value.strip()
        result[key.lower().replace(" ", "_")] = value.strip()
    return result


def _role_of(query: dict[str, str]) -> str:
    role = (query.get("local_role") or query.get("Local role") or "").strip().lower()
    if role.startswith("primary"):
        return "primary"
    if role.startswith("standby"):
        return "standby"
    if role.startswith("pending"):
        return "pending"
    return "unknown"


def _state_of(query: dict[str, str]) -> str:
    state = (query.get("db_state") or query.get("Db state") or "").strip()
    return state or "Unknown"


class StatusCollector:
    def __init__(self, config: Config, executor: Executor) -> None:
        self.config = config
        self.executor = executor
        self._lock = threading.Lock()
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0

    # ---------------------------------------------------------------- 单点
    def _database(self, container: str | None = None) -> dict[str, Any]:
        sql = (
            "select current_database() || '|' || current_user || '|' || version() || '|' || "
            "(select count(*) from pg_stat_activity where datname = current_database())"
        )
        try:
            result: ExecResult = self.executor.gsql(sql, container=container or self.config.db_container, timeout=8)
        except ExecutorError as exc:
            return {
                "reachable": False,
                "error": str(exc),
                "checkedAt": self.config.iso(),
            }
        if not result.ok:
            return {
                "reachable": False,
                "error": self.executor.mask(result.tail(600) or "数据库连接失败"),
                "checkedAt": self.config.iso(),
            }
        parts = result.stdout.strip().split("|")
        if len(parts) < 4:
            return {
                "reachable": False,
                "error": "数据库返回格式不完整：%s" % self.executor.mask(result.stdout.strip()[:300]),
                "checkedAt": self.config.iso(),
            }
        try:
            connections = int(parts[3])
        except ValueError:
            connections = None
        return {
            "reachable": True,
            "database": parts[0],
            "databaseUser": parts[1],
            "version": parts[2],
            "connections": connections,
            "checkedAt": self.config.iso(),
        }

    def _node(self, container: str, label: str, host: str, port: int) -> dict[str, Any]:
        if self.config.exec_mode == "local":
            # 本机直连（云主机/VMware 不装 Docker 时的回退）：用 gs_ctl 判断本地实例状态
            node: dict[str, Any] = {
                "name": label,
                "container": container,
                "host": host,
                "port": port,
                "status": "online",
                "role": "unknown",
                "dbState": "Unknown",
                "checkedAt": self.config.iso(),
                "error": "",
            }
            try:
                query = self.executor.gs_ctl("query", container, timeout=15)
            except ExecutorError as exc:
                node["status"] = "offline"
                node["dbState"] = "Unavailable"
                node["error"] = str(exc)
                return node
            if not query.ok:
                node["status"] = "offline"
                node["dbState"] = "Unavailable"
                node["error"] = self.executor.mask(query.tail(500) or "gs_ctl query 失败")
                return node
            parsed = parse_gs_ctl_query(query.stdout)
            node["role"] = _role_of(parsed)
            node["dbState"] = _state_of(parsed)
            # 单机模式 gs_ctl 返回 local_role=Normal，没有主备概念，按主节点展示
            if node["role"] == "unknown" and node["dbState"] == "Normal" and not self.config.standby_container:
                node["role"] = "primary"
            node["rawState"] = parsed
            return node

        try:
            running, reason = self.executor.container_running(container)
        except ExecutorError as exc:
            running, reason = False, str(exc)
        node: dict[str, Any] = {
            "name": label,
            "container": container,
            "host": host,
            "port": port,
            "status": "online" if running else "offline",
            "role": "unknown",
            "dbState": "Unknown",
            "checkedAt": self.config.iso(),
            "error": "",
        }
        if not running:
            node["error"] = reason or "容器未运行"
            return node

        try:
            query = self.executor.gs_ctl("query", container, timeout=15)
        except ExecutorError as exc:
            node["role"] = "unknown"
            node["dbState"] = "Unavailable"
            node["error"] = str(exc)
            return node
        if not query.ok:
            node["role"] = "unknown"
            node["dbState"] = "Unavailable"
            node["error"] = self.executor.mask(query.tail(500) or "gs_ctl query 失败")
            return node
        parsed = parse_gs_ctl_query(query.stdout)
        node["role"] = _role_of(parsed)
        node["dbState"] = _state_of(parsed)
        node["rawState"] = parsed
        return node

    def _replication_lag(self, standby_container: str) -> float | None:
        if not standby_container:
            return None
        # openGauss 的 pg_stat_replication 没有 replay_lag 字段；用备库 WAL receiver 的
        # sender_sent_location 与 receiver_replay_location 是否相等判断是否已追平。
        # 相等返回 0.0；仍有差距时没有可靠的秒数换算，返回 None（页面显示“—”）。
        sql = (
            "select case when sender_sent_location = receiver_replay_location "
            "then 0.0 else null end from pg_stat_get_wal_receiver() limit 1"
        )
        try:
            result = self.executor.gsql(sql, container=standby_container, timeout=8)
        except ExecutorError:
            return None
        if not result.ok:
            return None
        try:
            return float(result.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return None

    # ---------------------------------------------------------------- 汇总
    def collect(self, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        with self._lock:
            if not force and self._cached and now - self._cached_at < self.config.status_cache_seconds:
                return self._cached

            started = time.monotonic()
            nodes = [self._node(self.config.db_container, "node-a",
                                self.config.node_a_host, self.config.node_a_port)]
            if self.config.standby_container:
                nodes.append(self._node(self.config.standby_container, "node-b",
                                        self.config.node_b_host, self.config.node_b_port))

            primary = next((item for item in nodes if item["role"] == "primary"), None)
            standby = next((item for item in nodes if item["role"] == "standby"), None)
            # 切换后主节点会变，状态查询要跟着当前主节点走
            database = self._database(primary["container"] if primary else None)
            configured = bool(self.config.standby_container)
            lag = self._replication_lag(standby["container"]) if standby else None

            if configured and primary and standby:
                replication_state = "STREAMING" if standby["status"] == "online" and standby["dbState"] == "Normal" else "DEGRADED"
            elif configured:
                replication_state = "UNKNOWN"
            else:
                replication_state = "SINGLE"

            data = {
                "service": {
                    "name": self.config.service_name,
                    "version": self.config.version,
                    "execMode": self.config.exec_mode,
                    "databaseContainer": self.config.db_container,
                    "standbyContainer": self.config.standby_container or None,
                },
                "database": database,
                "nodes": nodes,
                "primary": primary,
                "standby": standby,
                "replication": {
                    "configured": configured,
                    "state": replication_state,
                    "lagSeconds": lag,
                },
                # 保持与 catalog-service 预留字段同名，前端可以平滑接入
                "status": "READY" if database.get("reachable") else "DEGRADED",
                "stale": False,
                "collectedAt": self.config.iso(),
                "durationMs": int((time.monotonic() - started) * 1000),
                "taskStore": {
                    "path": str(self.config.task_dir),
                    "count": self._task_count,
                },
            }
            self._cached = data
            self._cached_at = now
            return data

    @property
    def _task_count(self) -> int:
        try:
            return len(list(self.config.task_dir.glob("OP*.json")))
        except OSError:
            return 0
