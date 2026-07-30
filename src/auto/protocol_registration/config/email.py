# -*- coding: utf-8 -*-
"""
邮箱来源与验证码服务配置。

支持三种邮箱来源：
    - replacement：从 gmail_IMAP 补号账号 API 选择邮箱并读取验证码
    - outlook：从项目根目录 `用于注册的邮箱.txt` 读取 Outlook 池
    - gmail_imap：使用 gmail_IMAP 本地 Gmail 验证码 API
"""

import os

# True: REGISTER_EMAIL 留空时从配置的邮箱服务自动获取邮箱，OTP 自动收取
# False: 走人工输入邮箱 + 人工填 OTP 的流程
USE_EMAIL_SERVICE = True

# OTP 来源：replacement 使用 gmail_IMAP 补号账号 API；outlook 使用旧 Outlook 池；
# gmail_imap 调用 gmail_IMAP 本地 Gmail IMAP API。
OTP_PROVIDER = os.environ.get("OTP_PROVIDER", "replacement").strip().lower()

# gmail_IMAP 服务配置（OTP_PROVIDER="gmail_imap" 时生效）
GMAIL_IMAP_API_BASE = "http://127.0.0.1:3000"
GMAIL_IMAP_API_TIMEOUT = 15
GMAIL_IMAP_POLL_INTERVAL = 3
GMAIL_IMAP_MAX_WAIT = 90

# 落库来源默认与 OTP_PROVIDER 一致；保留常量是为了兼容既有调用和落库字段。
EMAIL_SOURCE = os.environ.get("EMAIL_SOURCE", OTP_PROVIDER).strip() or OTP_PROVIDER


# ============================================================
# gmail_IMAP 补号账号 API（OTP_PROVIDER="replacement" 时生效）
# ============================================================

REPLACEMENT_API_BASE = os.environ.get(
    "REPLACEMENT_API_BASE",
    "http://127.0.0.1:13100",
).rstrip("/")
# 为空时由 core.replacement_client 从相邻 gmail_IMAP/.env 读取 ADMIN_PASSWORD。
REPLACEMENT_ADMIN_PASSWORD = os.environ.get("REPLACEMENT_ADMIN_PASSWORD", "")
REPLACEMENT_SERVICE_ENV_FILE = os.environ.get("REPLACEMENT_SERVICE_ENV_FILE", "")
REPLACEMENT_ACCOUNT_ID = os.environ.get("REPLACEMENT_ACCOUNT_ID", "").strip()
REPLACEMENT_API_TIMEOUT = float(os.environ.get("REPLACEMENT_API_TIMEOUT", "15"))
REPLACEMENT_CODE_REQUEST_TIMEOUT = float(
    os.environ.get("REPLACEMENT_CODE_REQUEST_TIMEOUT", "60")
)
REPLACEMENT_CODE_POLL_INTERVAL = float(
    os.environ.get("REPLACEMENT_CODE_POLL_INTERVAL", "5")
)
REPLACEMENT_CODE_MAX_WAIT = float(
    os.environ.get("REPLACEMENT_CODE_MAX_WAIT", "120")
)


# ============================================================
# Outlook 模式（外购账号池 + 取信服务）
# ============================================================

OUTLOOK_ACCOUNTS_FILE = "用于注册的邮箱.txt"

# 取邮件 API 的根 URL（双协议 graph + imap，自动回退）
OUTLOOK_API_BASE = "https://mail.chatai.codes"


# ============================================================
# OTP 轮询参数
# ============================================================

OTP_POLL_INTERVAL = 3
OTP_MAX_WAIT = 90

# Outlook 双协议取件：抓到一封 OTP 后再多等多少秒看是否有更晚到达的邮件。
OTP_SETTLE_SECONDS = 5
