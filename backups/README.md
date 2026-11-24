# 备份归档目录

`compose.web.yaml` 把这里挂载到 dbops-service 容器的 `/backup`。

- 导出的 `*.dump` 与同名 `*.dump.json` 清单都在这里生成。
- 归档包含业务数据，**不要提交到 Git**（已在 .gitignore 中排除）。
- 演示前清空此目录会同时清空页面上的备份列表，属正常。
