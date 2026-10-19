# DocuChat API：本地持久化版

统一错误为`{"error":{"code":"...","message":"..."}}`。仅本机单用户，无认证；不要向公网暴露。

| 方法 | 路径 | 请求/返回 |
|---|---|---|
| GET | /api/health | status/product/instanceId/mode/configured/storageVersion/documents/models/evidenceCheck |
| GET | /api/documents | {documents:[文档元数据]}，不返回已删除记录 |
| POST | /api/upload | multipart唯一file；新建JSON201，复用JSON200；也支持SSE |
| POST | /api/documents/:id/reindex | 从已保存PDF重新解析/embedding；也支持SSE；真实模式会计费 |
| POST | /api/documents/:id/cancel | 取消正在处理的文档；204 |
| DELETE | /api/documents/:id | 删除PDF/分块/向量，清除引用原文，保留历史回答；204 |
| GET | /api/documents/:id/file | 原始application/pdf；支持浏览器Range与#page=N |
| GET | /api/sessions | {sessions:[会话元数据]} |
| POST | /api/sessions | JSON {documentIds:[]}；允许空范围，返回会话201 |
| GET | /api/sessions/:id | 会话元数据+messages |
| PATCH | /api/sessions/:id | JSON {documentIds:[...]}; 保存范围草稿 |
| DELETE | /api/sessions/:id/messages | 清空消息并中止活动回答；204 |
| POST | /api/sessions/:id/cancel | 可传{messageId}，避免迟到取消命令影响新请求；204 |
| POST | /api/chat | {sessionId,documentIds:[...],question}；必须使用已创建会话 |

chat保留单文档documentId字段兼容入口；优先使用documentIds。范围为1–20个不重复ID，后端验证存在、ready及索引兼容。question为1–2000字符。请求开始时保存范围快照，后续切换不会改变本次范围。多个会话可有独立记录；同一会话生成中返回CHAT_BUSY。

文档包含documentId/name/hash/status/compatible/needsReindex/error/pages/emptyPages/chunks/embeddingModel/dimension/splitConfig/revision/createdAt/updatedAt/mode。状态processing/ready/failed；删除中断可出现deleting供再次删除。ready但配置不兼容的文档不可选择。

聊天结果包含id/requestId/sessionId/documentIds/answer/supported/citations/retrieved/citationValidation/evidenceCheck/metrics/mode。saved messages还含question、status、scope名称快照、创建时间和错误。消息状态streaming/done/stopped/error/interrupted；清空不删除文档。

`EVIDENCE_CHECK=true` 启用实验性生成后检查，默认false。结果的 `evidenceCheck.status` 为 disabled（未启用）、skipped（原有流程已拒答）、passed（模型认为引文支持）、rejected（未通过）、unavailable（核验服务错误）。rejected/unavailable清空引用并令supported=false；passed不保证语义正确。`citationValidation` 仅记录此前ID/引句校验结果，不代表后续语义检查通过。核验器的详细主张不持久化。

citations来自本次检索，并再次与SQLite核对documentId、chunkId、页码、文本、索引revision及范围；模型只返回临时S编号和原文quote。返回id/documentId/name/page/chunkId/text/quote/revision。删除后sourceDeleted=true，移除text/quote。retrieved为候选，不等同答案证据。supported是模型主张结合格式检查后的标志，不是语义正确性认证。

## POST SSE

设置Accept: text/event-stream：
- 上传：document（处理中ID）→ stage(parsing/embedding/indexing) → done；复用直接done。
- 问答：message（服务端messageId）→ stage(retrieving) → retrieval → stage(generating) → delta → done。
- 启用证据检查时不发候选delta；原有校验通过后发送stage(checkingEvidence)，再返回最终done。原有拒答无需checkingEvidence；取消/超时不保存候选草稿。
- 错误：error事件；头已发送时HTTP仍是200，必须检查事件。EOF没有done属于失败。
- 断开fetch会取消；也可使用cancel端点。停止后部分输出可作为未完成草稿保留，不保留引用。
- done应替换未核验增量文本；错误/停止不得假装已完成。

metrics提供可获得的durationMs/firstTokenMs/retrievalMs/embeddingTokens/inputTokens/cachedInputTokens/outputTokens/totalTokens。顶层聊天token数仅为生成，额外核验耗时为evidenceCheckMs，核验token数在evidenceCheckUsage内（跳过或不可用时为null，null不是已知零费用）。启用检查时firstTokenMs记录最终内容可释放的服务端时点，不再是生成首token；它不是浏览器首字渲染耗时。结构化日志额外记录阶段耗时与检索chunkId，不记录全文、问题、回答或密钥。

常见错误：400 DOCUMENT_REQUIRED/QUESTION_INVALID/SESSION_REQUIRED/INVALID_JSON；404 SESSION_NOT_FOUND/DOCUMENT_NOT_FOUND；409 DOCUMENT_EXISTS/DOCUMENT_BUSY/DOCUMENT_NOT_READY/INDEX_CONFIG_CHANGED/SOURCE_CHANGED/CHAT_BUSY/COMPATIBLE_COPY_EXISTS/PDF_CHANGED；410 DOCUMENT_DELETED/PDF_MISSING；413 LIMIT_FILE_SIZE/DOCUMENT_TOO_LARGE；415 PDF_REQUIRED；422 PDF_NO_TEXT/PDF_PARSE_FAILED；429 BUSY；499 CANCELLED；502 MODEL_FAILED/MODEL_AUTH_FAILED/EMBEDDING_INVALID；503 API_KEY_MISSING/MODEL_RATE_LIMIT/INDEX_FULL；504 MODEL_TIMEOUT。

## Interface language contract (interface revision)

The API is language-neutral: errors always include stable `error.code` (HTTP JSON and SSE error events). Existing `message` fields are diagnostic/legacy text; clients must not match or display them as localized UI. The frontend maps codes through frontend/src/locales.js and uses UNKNOWN for unrecognized codes. Network/stream failures receive local stable codes too.

Session objects additionally include `isUntitled` for an empty server-created default session. This localizes the placeholder without changing stored user titles or questions. Dates remain numeric timestamps; clients format with Intl. SSE stages are parsing/embedding/indexing/retrieving/generating/checkingEvidence, translated by the client.

No locale field is sent on upload/chat requests. UI locale is stored only under localStorage key docuchat-language (en / zh-CN), separately from docuchat-session. Answer-language preference belongs in the user's question. Changing UI locale issues no API mutations and must not cancel streaming, change scope or rewrite saved messages.
