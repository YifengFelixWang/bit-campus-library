"""dbops-service 纯逻辑单元测试（不需要数据库和 Docker）。

运行：
    python -m unittest discover -s tests -v
"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dbops.config import Config
from dbops.executor import Executor, ExecResult
from dbops.operations import Operations, OperationError, TARGET_DB_PATTERN
from dbops.status import parse_gs_ctl_query, _role_of, _state_of
from dbops.tasks import TaskStore


PRIMARY_OUTPUT = """
[2026-11-23 19:00:00]: querying...
HA state:
\tlocal_role                     : Primary
\tstatic_connections             : 1
\tdb_state                       : Normal
\tdetail_information             :
"""

STANDBY_OUTPUT = """
HA state:
\tlocal_role                     : Standby
\tstatic_connections             : 1
\tdb_state                       : Normal
\tdetail_information             : 
"""


class StatusParseTest(unittest.TestCase):
    def test_primary_role(self):
        parsed = parse_gs_ctl_query(PRIMARY_OUTPUT)
        self.assertEqual(_role_of(parsed), "primary")
        self.assertEqual(_state_of(parsed), "Normal")

    def test_standby_role(self):
        parsed = parse_gs_ctl_query(STANDBY_OUTPUT)
        self.assertEqual(_role_of(parsed), "standby")

    def test_unknown_output(self):
        self.assertEqual(_role_of({}), "unknown")
        self.assertEqual(_state_of({}), "Unknown")


class TaskStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"OPS_TASK_DIR": self.temp.name}, clear=False)
        self.env.start()
        self.store = TaskStore(Config())

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_create_and_steps(self):
        task = self.store.create("backup", "创建数据库备份", "ops1", {"note": "演示"})
        self.assertRegex(task["id"], r"OP\d{8}-\d{6}-[0-9a-f]{4}")
        self.assertEqual(task["status"], "QUEUED")
        index = self.store.add_step(task["id"], "检查数据库连接")
        self.store.finish_step(task["id"], index, "SUCCEEDED", "ok")
        loaded = self.store.get(task["id"])
        self.assertEqual(loaded["steps"][0]["status"], "SUCCEEDED")
        self.assertEqual(loaded["params"]["note"], "演示")

    def test_invalid_id(self):
        with self.assertRaises(ValueError):
            self.store.get("../../etc/passwd")

    def test_list_order(self):
        first = self.store.create("backup", "备份", "ops1", {})
        second = self.store.create("restore", "恢复", "ops1", {})
        items = self.store.list()
        self.assertEqual(len(items), 2)
        self.assertIn(first["id"], [item["id"] for item in items])
        self.assertIn(second["id"], [item["id"] for item in items])


class ValidationTest(unittest.TestCase):
    def setUp(self):
        self.config = Config()
        self.ops = Operations(self.config, None, None, None)

    def test_reject_production_database(self):
        with self.assertRaises(OperationError):
            self.ops._validate_target("library")

    def test_reject_other_database(self):
        with self.assertRaises(OperationError):
            self.ops._validate_target("postgres")

    def test_accept_verify_database(self):
        self.assertEqual(self.ops._validate_target("library_verify"), "library_verify")
        self.assertEqual(self.ops._validate_target("library_verify_20261123"), "library_verify_20261123")

    def test_reject_illegal_name(self):
        with self.assertRaises(OperationError):
            self.ops._validate_target("library_verify;drop")

    def test_pattern(self):
        self.assertTrue(TARGET_DB_PATTERN.fullmatch("library_verify"))
        self.assertFalse(TARGET_DB_PATTERN.fullmatch("-bad"))


class PrimaryFollowTest(unittest.TestCase):
    """切换后备份/恢复要跟随新主，不能写死 node-a。"""

    def setUp(self):
        self.env = mock.patch.dict(os.environ, {
            "OPS_DB_CONTAINER": "library-opengauss-a",
            "OPS_STANDBY_CONTAINER": "library-opengauss-b",
        }, clear=False)
        self.env.start()
        self.ops = Operations(Config(), None, None, None)

    def tearDown(self):
        self.env.stop()

    def test_follow_new_primary_after_switchover(self):
        self.ops._roles = lambda: {"library-opengauss-a": "standby", "library-opengauss-b": "primary"}
        self.assertEqual(self.ops._primary_container(), "library-opengauss-b")

    def test_use_node_a_before_switchover(self):
        self.ops._roles = lambda: {"library-opengauss-a": "primary", "library-opengauss-b": "standby"}
        self.assertEqual(self.ops._primary_container(), "library-opengauss-a")

    def test_fallback_when_roles_unknown(self):
        self.ops._roles = lambda: {"library-opengauss-a": "unknown", "library-opengauss-b": "unknown"}
        self.assertEqual(self.ops._primary_container(), "library-opengauss-a")

    def test_single_instance_skips_probe(self):
        with mock.patch.dict(os.environ, {"OPS_STANDBY_CONTAINER": ""}, clear=False):
            ops = Operations(Config(), None, None, None)
            ops._roles = lambda: (_ for _ in ()).throw(AssertionError("不应查询角色"))
            self.assertEqual(ops._primary_container(), "library-opengauss-a")


class ExecutorTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"OPS_DB_PASSWORD": "123456789000",
                                                "OPS_DB_CONTAINER": "library-opengauss"}, clear=False)
        self.env.start()
        self.config = Config()
        self.executor = Executor(self.config)

    def tearDown(self):
        self.env.stop()

    def test_mask_password(self):
        self.assertEqual(self.executor.mask("password=123456789000"), "password=******")

    def test_safe_file_name(self):
        self.assertTrue(Executor.safe_file_name("library-20261123-190000-abcd.dump"))
        self.assertFalse(Executor.safe_file_name("../library.dump"))
        self.assertFalse(Executor.safe_file_name("library.dump;rm"))

    def test_docker_argv(self):
        argv = self.executor._docker_args("library-opengauss", ["gs_ctl", "query", "-D", "/data"])
        self.assertEqual(argv[0], "docker")
        self.assertEqual(argv[1], "exec")
        self.assertIn("library-opengauss", argv)
        self.assertIn("gs_ctl", argv)
        self.assertNotIn("123456789000", " ".join(argv))

    def test_local_mode_uses_tcp_host(self):
        with mock.patch.dict(os.environ, {"OPS_EXEC_MODE": "local", "OPS_DB_HOST": "127.0.0.1",
                                          "OPS_NODE_A_PORT": "15432"},
                             clear=False):
            config = Config()
            executor = Executor(config)
            self.assertEqual(executor._host_args("library-opengauss"), ["-h", "127.0.0.1", "-p", "15432"])

    def test_docker_mode_uses_container_socket(self):
        self.assertEqual(self.executor._host_args("library-opengauss"), ["-p", "5432"])

    def test_local_ha_maps_each_node_to_its_port(self):
        with mock.patch.dict(os.environ, {
            "OPS_EXEC_MODE": "local",
            "OPS_DB_CONTAINER": "/home/user/og/data",
            "OPS_STANDBY_CONTAINER": "/home/user/og/data-b",
            "OPS_NODE_A_PORT": "15432",
            "OPS_NODE_B_PORT": "15443",
        }, clear=False):
            executor = Executor(Config())
            self.assertEqual(executor._host_args("/home/user/og/data"), ["-h", "127.0.0.1", "-p", "15432"])
            self.assertEqual(executor._host_args("/home/user/og/data-b"), ["-h", "127.0.0.1", "-p", "15443"])

    def test_local_gs_ctl_uses_container_as_datadir(self):
        with mock.patch.dict(os.environ, {
            "OPS_EXEC_MODE": "local",
            "OPS_DB_CONTAINER": "/home/user/og/data",
            "OPS_STANDBY_CONTAINER": "/home/user/og/data-b",
        }, clear=False):
            executor = Executor(Config())
            executor._run = lambda argv, timeout=None: ExecResult(argv, "x", 0, "", "", 0)
            result = executor.gs_ctl("query", "/home/user/og/data-b")
            self.assertIn("/home/user/og/data-b", result.argv)
            self.assertNotIn("/var/lib/opengauss/data", result.argv)


class BackupListTest(unittest.TestCase):
    def test_sidecar_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            env = mock.patch.dict(os.environ, {"OPS_BACKUP_DIR": temp}, clear=False)
            env.start()
            try:
                config = Config()
                ops = Operations(config, None, None, None)
                dump = Path(temp) / "library-20261123-190000-abcd.dump"
                dump.write_bytes(b"PGDMP" + b"0" * 100)
                meta = dump.with_suffix(".dump.json")
                meta.write_text('{"note":"演示备份","taskId":"OP20261123-190000-abcd"}', encoding="utf-8")
                items = ops.list_backups()
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]["note"], "演示备份")
                self.assertGreater(items[0]["sizeBytes"], 0)
            finally:
                env.stop()


if __name__ == "__main__":
    unittest.main()
