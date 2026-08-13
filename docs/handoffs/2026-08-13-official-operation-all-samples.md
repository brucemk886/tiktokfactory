# 官方 API 自运营：全量样本统计

## 目标

取消“发布满 24 小时且播放不少于 200”才算有效样本的硬门槛，让官方 API 返回的全部视频参与统计、基准计算和策略诊断。

## 已完成

- 所有视频均进入账号与相近时长基准统计。
- 所有视频均执行内容诊断与策略判断。
- `minimumViews` 与 `minimumPublishedHours` 均改为 `0`，并明确 `sampleFilteringEnabled: false`。
- 原 24 小时、200 播放条件仅保留为 `sampleMaturity` 和 `sampleWarnings` 提示，不再阻止统计或诊断。
- 不再因早期或低播放样本强制返回 `observe`。

## 修改文件

- `scripts/content-diagnosis-rules.js`
- `scripts/content-diagnosis-rules.test.js`

## 验证

- `node --check scripts/content-diagnosis-rules.js`
- `node --check scripts/content-diagnosis-rules.test.js`
- `node --test scripts/content-diagnosis-rules.test.js`
- 结果：3 个测试全部通过。

## 运行说明

当前运行中的 Local Factory 需要重启后才会加载本次规则变更。本次未执行重启或部署。
