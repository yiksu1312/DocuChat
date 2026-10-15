# 设计取舍

- **SQLite与普通文件。** 单机单用户无需独立服务。使用当前Node24自带node:sqlite，24.12仍提示experimental，后续Node变更需回归测试。原PDF单独存储，SQLite事务负责索引/会话状态；不把大二进制PDF塞进聊天记录。
- **恢复而非重算。** 向量作为JSON数组保存，重启只读元数据，提问时加载所选索引；已完成上传不重新解析或embedding。中断任务进入失败/中断状态，由用户明确重试，避免自动产生费用。
- **范围先确定。** 每次请求复制documentIds并验证状态，消息保存文档名称快照。查询和最终引用再检查当前数据；删除或重新索引时阻止旧来源被当成有效答案。前端使用generation计数和AbortController防止迟到事件污染新会话。
- **简单向量检索。** 不引入混合检索。每份所选文档保留一个最高相似度候选，剩余按相似度填充，目标max(8,2×文档数)、最多40片段。这有助于暴露冲突，但也会纳入无关片段；不据此宣称答案可靠，也不显示置信度。
- **历史只帮助理解。** 最多3轮可兼容范围历史，检索查询使用其中最后2轮；模型仍必须引用当前检索原文。尚未真实验证复杂指代、恶意历史或多文档冲突推理质量。
- **引用能找到原件。** 引用字段来自SQLite，模型不能指定页码。浏览器原生PDF查看器使用#page=N，避免新增PDF渲染/坐标标注框架。仅核对ID/原文，不把校验结果包装成语义正确性。
- **明确小规模边界。** 20份文档、每份10MB/200页/30万字符；2次索引、4次回答并发。SQLite同步操作及余弦全扫描没有大型资料性能保证，未压测。聊天累积需要用户清理。
- **本地数据不等于完全离线AI。** PDF/聊天本地持久化，真实问答仍发送所需文本到现有OpenAI提供方。mock只验证工程流程。

SQLite API依据：[Node24官方文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。实际兼容性以本机24.12执行的恢复/事务/备份测试为准。

## Bilingual UI / publication preparation

A React language context plus centralized en/zh-CN dictionaries keeps the two-language interface lightweight; no new i18n dependency or stack change. ConfigProvider synchronizes Ant Design. Stable error/stage codes separate API behavior from presentation; raw provider messages are never used as translation keys. Intl formats dates, lists, quantities and plural forms. Locale changes re-render labels without re-mounting the app or using locale in network-effect dependencies.

A reviewed source-file allowlist supports clean installation without copying credentials, dependencies, or runtime data. Release checks cover the current source snapshot and its Git history.
