# 2026-07-07 浏览器自动化状态判定规则

## 背景

用户要求将本次 Roxy OpenAI 注册流程中的页面状态误判问题总结到 `AGENTS.md`，避免后续 AI 重复犯错。

## 本次沉淀的问题

- OTP 提交后不能把通用点击函数的 `formGone` 当成验证码成功。
- 页面错误提示可能延迟出现，不能把“短时间没看到错误”当成成功。
- OpenAI 页面过渡期间可能残留 disabled/detached password input，不能只凭 `input[type="password"]` 存在就判定回到密码页。
- 实时浏览器状态、截图、URL、可访问性树和 DOM 证据优先于代码预期和历史日志。

## 修改

- `AGENTS.md`
  - 新增 `0.1 浏览器自动化状态判定规则`，要求提交后按阶段状态机分类、操作元素前检查 `isEnabled()` 和 disabled/stale 条件、冲突时先采集当前页面证据。
- `.learnings/LEARNINGS.md`
  - 新增 `LRN-20260707-001`，并标记已推广到 `AGENTS.md`。
- `docs/changes/CHG-073-browser-automation-state-judgment-rule.md`
  - 记录本次长期规则变更。

## 验证

文档规则已写入目标文件；本次不涉及运行时代码。

## 后续

当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
