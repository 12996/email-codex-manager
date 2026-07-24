# CHG-097 补号账号注册 AT 快速复制

状态：implemented
创建日期：2026-07-24
关联 PRD：PRD-003

补号管理页每个账号邮箱下方增加“复制 AT”按钮。按钮仅通过已认证的本地管理接口读取 `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt` 并复制纯 access token；文件不存在或为空时提示“AT 未找到”。
