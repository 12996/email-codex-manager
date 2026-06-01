# 补号账号后端设计

## 背景

新增一个“补号账号”后端能力，用于管理需要补号的邮箱账号数据，并为后续前端 UI/PRD 提供明确的数据字段、状态流转和用户操作定义。

本设计只覆盖后端，不设计前端界面。

## 设计目标

- 单独存储补号账号数据，不混入现有 Gmail IMAP 账号表。
- 邮箱号全局唯一，不允许重复。
- 管理员可以新增、修改、删除账号信息。
- 管理员可以手动修改账号状态。
- 后端支持实时调用 SMS 接口获取验证码，但验证码不落库。
- 后端支持调用自动化接口执行补号。
- 只记录成功补号次数，不记录补号接口调用次数。
- 不记录操作日志；前端“操作”列不入库。

## 数据表

新增表：`replacement_accounts`

```sql
CREATE TABLE replacement_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  email TEXT NOT NULL,
  phone TEXT,

  sms_api TEXT,
  sms_last_error TEXT,

  activation_method TEXT,
  activated_at TEXT,

  status TEXT NOT NULL DEFAULT 'pending',
  status_updated_at TEXT,
  status_note TEXT,

  replacement_count INTEGER NOT NULL DEFAULT 0,

  json_payload TEXT,
  json_fetched_at TEXT,

  last_replace_at TEXT,
  last_error TEXT,

  remark TEXT,

  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_accounts_email_unique
ON replacement_accounts (lower(trim(email)));
```

## 字段说明

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `email` | 邮箱号，全局唯一 |
| `phone` | 手机号，可为空，可重复 |
| `sms_api` | SMS 接口网址，用于实时获取验证码 |
| `sms_last_error` | 最近一次请求 SMS 接口失败原因 |
| `activation_method` | 开通方式 |
| `activated_at` | 开通时间 |
| `status` | 当前账号状态 |
| `status_updated_at` | 最近状态更新时间 |
| `status_note` | 状态备注 |
| `replacement_count` | 成功补号次数 |
| `json_payload` | 获取到的 JSON 原文 |
| `json_fetched_at` | JSON 获取时间 |
| `last_replace_at` | 最近一次成功补号时间 |
| `last_error` | 最近一次补号或业务错误 |
| `remark` | 管理员备注 |
| `deleted_at` | 软删除时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

## 不入库字段

- 前端“操作”列不入库。
- 验证码不入库。
- 验证码获取时间不入库。
- SMS 返回 payload 不入库。
- 补号接口调用次数不入库。
- 用户操作日志不入库。

## 状态定义

数据库存英文状态，前端可展示中文。

| 后端状态 | 中文含义 | 说明 |
| --- | --- | --- |
| `pending` | 待处理 | 新增后的默认状态 |
| `active` | 正常 | 账号当前可用 |
| `banned` | 已封禁 | 账号不可用，需要补号 |
| `replacing` | 补号中 | 自动化补号接口执行中 |
| `replaced` | 已补号 | 自动化补号成功 |
| `failed` | 失败 | 自动化接口失败或管理员手动标记失败 |

管理员可手动修改为：

- `pending`
- `active`
- `banned`
- `replaced`
- `failed`

`replacing` 建议只由系统自动设置，不提供管理员手动选择。

## 后端接口

### CRUD

```text
GET    /replacement-accounts
GET    /replacement-accounts/:id
POST   /replacement-accounts
PUT    /replacement-accounts/:id
DELETE /replacement-accounts/:id
```

规则：

- 列表默认只返回 `deleted_at IS NULL` 的记录。
- 删除使用软删除：写入 `deleted_at`。
- 新增和修改都需要校验 `email` 唯一。
- 邮箱保存前需要 `trim`。
- 邮箱唯一判断大小写不敏感。

### 修改状态

```text
PATCH /replacement-accounts/:id/status
```

请求示例：

```json
{
  "status": "banned",
  "status_note": "管理员手动标记封禁"
}
```

更新字段：

- `status`
- `status_note`
- `status_updated_at`
- `updated_at`

### 获取 SMS 验证码

```text
POST /replacement-accounts/:id/fetch-sms-code
```

逻辑：

1. 根据 `id` 读取 `sms_api`。
2. 请求 `sms_api`。
3. 成功后直接返回验证码给调用方，不写入数据库。
4. 失败后写入 `sms_last_error` 和 `updated_at`。

成功响应示例：

```json
{
  "code": "123456"
}
```

### 获取 JSON

```text
POST /replacement-accounts/:id/fetch-json
```

成功后更新：

- `json_payload`
- `json_fetched_at`
- `last_error = NULL`
- `updated_at`

失败后更新：

- `last_error`
- `updated_at`

### 自动补号

```text
POST /replacement-accounts/:id/replace
```

状态流转：

```text
开始补号
  -> status = replacing

补号成功
  -> status = replaced
  -> replacement_count = replacement_count + 1
  -> last_replace_at = 当前时间
  -> last_error = NULL

补号失败
  -> status = failed
  -> last_error = 错误信息
  -> replacement_count 不变
```

## 给 PRD/UI 的用户操作记录

这些是后端支持的用户操作，不代表前端布局。

| 用户操作 | 后端接口 | 后端影响 |
| --- | --- | --- |
| 新增账号 | `POST /replacement-accounts` | 创建补号账号，默认 `pending` |
| 修改账号 | `PUT /replacement-accounts/:id` | 修改账号基础信息 |
| 删除账号 | `DELETE /replacement-accounts/:id` | 软删除记录 |
| 修改状态 | `PATCH /replacement-accounts/:id/status` | 修改账号状态和状态备注 |
| 获取验证码 | `POST /replacement-accounts/:id/fetch-sms-code` | 实时请求 SMS 接口，不保存验证码 |
| 获取 JSON | `POST /replacement-accounts/:id/fetch-json` | 保存 JSON 原文和获取时间 |
| 自动补号 | `POST /replacement-accounts/:id/replace` | 执行补号，成功后补号次数加一 |

## 定稿规则

- `email` 不允许重复。
- `phone` 允许为空、允许重复。
- `sms_api` 存 SMS 接口网址。
- 验证码只实时返回，不保存到数据库。
- 只记录成功补号次数：`replacement_count`。
- 不记录补号尝试次数。
- 不做操作日志表。
- 删除使用软删除。
- 管理员可以手动修改账号信息和账号状态。
