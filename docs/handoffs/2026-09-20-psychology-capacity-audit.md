# Goal

审计心理学自动发布每天 200 个账号 × 3 条的容量和可靠性。用户明确图文爆款复刻为主。

# Decisions

- 本轮是审计和压测，仅增加独立测试/报告，不改变生产逻辑或部署。
- 所有发布、上传和 AI 使用模拟；没有实际发帖或干扰工人任务。
- 正常负载：10 个创建任务 × 20 账号 × 3 条，30 个发布分组、3,600 张图片。
- 发现组内失败阻塞、失效素材重试无法恢复、claim 503 被当权限错误、重复全量账号查询、跨批次选源重复、记录/任务列表截断等问题。
- 中台孤立素材清理在每日维护触发，并非每 15 分钟；清理时才判断素材未引用且年龄超过 15 分钟。检查的是 sibling 仓库源码，未比对线上部署。

# Files changed

- scripts/psychology-publish-load-test.mjs：真实业务 handlers + 内存 SQLite，严格模拟所有外部请求，正常负载及故障注入，支持 --faults-only。
- scripts/psychology-photo-render-benchmark.mjs：本机真实 Chrome 文字卡基准。
- scripts/psychology-account-scope-benchmark.mjs：账号范围计算基准。
- docs/reports/2026-09-20-psychology-*：中文报告和基准/故障输出。

# Tests performed

- factory-cloud npm test：457/457 通过。
- 正常模拟 600 条的全部断言通过，随后故障测试的最后一个 claim 测试因缺少工人能力声明失败；已修正测试请求，单独补跑故障组：4 个场景断言全部通过，退出码 0。详见报告，勿宣称初版整个进程退出成功。
- Chrome：12 条 72 张，平均六页/条 0.854 秒，无网络/AI/上传。
- scopeOfficialAccess：20/200/400 账号，各 10 次；200 账号约 60.66 ms，400 账号约 250.13 ms，本机 Node 数字。
- 新脚本 node --check 通过。

# Unfinished work

- 所有报告中的生产可靠性问题尚未修复。本次不包含完整真实 Workflows、中台和 TikTok 容量验收。
- 未查询供应商额度/限流实况；2 条生产 worker 完成样本不足以推断 600 条 SLA。

# Recommended next step

先实施分组失败隔离、失效素材恢复、临时账号查询故障重试，再优化账号校验和图文独立并发。对中台是否已接受请求必须先核实，恢复过程中保留幂等性；不要简单更换 externalId 重发。上线实现须遵守提交、推送 main、干净工作区与 origin/main 相等，再用规定 npm deploy 流程。
