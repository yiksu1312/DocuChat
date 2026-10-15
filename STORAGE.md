# 本地数据与恢复

默认真实数据：data/openai；mock：data\mock。DATA_DIR可指定独立目录。数据库、PDF、向量、日志、环境配置和备份不进入Git。

```text
DATA_DIR/
  docuchat.sqlite       # SQLite schema/user_version = 1
  docuchat.sqlite-wal   # 运行中可能存在
  docuchat.sqlite-shm
  store.lock           # 单后端写入锁，记录PID
  pdfs/<documentId>.pdf # 原始文件；不使用用户文件名作为磁盘路径
```

documents保存SHA-256、名称、模型、实际向量维度、模式、分块配置、状态和版本；chunks保存原文、物理页码、chunkId和JSON向量；sessions/messages保存范围快照和聊天。向量完整保存，不在启动时调用embedding。查询时加载所选文档向量到内存，用余弦相似度检索。

PDF先写临时文件再原子更名；完成索引时分块/向量/ready状态一起事务提交。SQLite WAL负责提交恢复。启动将processing标记为PROCESSING_INTERRUPTED，将streaming消息标记interrupted；不会把半成品加入检索。重试从本地PDF重新处理，不自动产生付费请求。

内容哈希与配置签名共同去重。签名含embedding模型、mock/真实模式、分块大小800/重叠100/按页策略与解析版本。维度按实际响应保存，查询维度不符会将该索引标记失败并提供重新索引入口。回答模型不决定向量兼容性。

删除先记deleting，再移除PDF，事务删除向量/分块并清除历史引用的text/quote；历史回答及最小来源信息保留。删除中断在下次启动继续完成。答案文字可能仍含文档事实，若也要清除这些内容，请清空相关聊天；已有离线备份不会自动修改。SQLite采用secure_delete，但不是对磁盘、WAL历史或备份做法证级擦除。

## 备份

先Ctrl+C停止使用此DATA_DIR的后端，然后：

```powershell
cd DocuChat
npm run backup
```

复制到data-backups下唯一新目录，比较每个文件SHA-256，写manifest.json。不会覆盖已有备份、删除源文件或跟随目录链接；持有单写入锁以防备份中途后端启动。若使用自定义DATA_DIR，运行备份前在同一终端设置相同变量。

恢复时先停止服务，将完整备份复制到一个新的空目录（包含sqlite及可能的wal/shm和pdfs），让DATA_DIR指向该目录再启动；不要把两个版本混在一起。备份包含本机明文内容，应按私人资料保护。备份manifest仅有路径/大小/哈希，没有密钥。

当前 schema 版本为 1。数据库结构变更必须先备份并实现显式迁移；遇到未知版本或未标版本的非空数据库时，服务拒绝启动，不自动覆盖。

store.lock活跃PID阻止第二个后端。异常退出遗留且PID已不存在时自动接管；无法确定的锁报错，不猜测删除。若Windows重用PID导致保守拒绝，请确认没有同目录后端后再处理该锁。
