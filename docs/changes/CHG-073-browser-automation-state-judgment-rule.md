# CHG-073 浏览器自动化状态判定规则

状态：implemented

创建日期：2026-07-07

关联 PRD：PRD-003

## 背景

Roxy OpenAI 注册流程连续暴露两类自动化状态判断问题：

1. OTP 提交后把通用 `clickContinueButtonReliably()` 的 `formGone` 当成成功，但 OTP 页本来没有 `input[type="email"]`，导致错误验证码未等到 `Incorrect code` 就误入 Step 6。
2. OTP 等待阶段把 OpenAI 过渡期间残留的 password input 当作可填写密码页，但 Playwright 判定该元素 `not enabled` 且随后 detached，导致 `locator.click` 超时。

这不是单个 selector 问题，而是浏览器自动化状态机的长期规则缺失。

## 目标

- 将“提交后必须按页面状态重新分类、不能信任通用点击结果”的规则写入 `AGENTS.md`。
- 将“操作输入框前必须检查元素可用性和阶段语义”的规则写入 `AGENTS.md`。
- 让后续 AI 接手 Roxy/OpenAI/ChatGPT 自动化时优先采集实时页面证据，再修状态机。

## 验收标准

- [x] `AGENTS.md` 新增浏览器自动化状态判定规则。
- [x] 规则明确覆盖 OTP 错码、密码页过渡态 DOM、元素 enabled/stale 判断、提交后状态分类和回归测试要求。
- [x] 本次经验同步记录到 `.learnings/LEARNINGS.md` 并标记已推广到 `AGENTS.md`。

## 实现记录

实现日期：2026-07-07

- `AGENTS.md`
  - 新增 `0.1 浏览器自动化状态判定规则`。
- `.learnings/LEARNINGS.md`
  - 新增 `LRN-20260707-001`，记录本次状态机误判经验。

## 回滚

删除 `AGENTS.md` 中 `0.1 浏览器自动化状态判定规则`，并移除 `.learnings/LEARNINGS.md` 中对应 learning 即可回滚；不影响运行时代码。
