# -*- coding: utf-8 -*-
"""
ChatGPT 协议注册全流程入口
串联 12 个步骤，自动完成 ChatGPT 账号注册
"""
import sys
import argparse
import json
import logging
import os
import random
import string
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from config import (
    REGISTER_EMAIL, REGISTER_NAME, REGISTER_BIRTHDAY,
    ENABLE_2FA, USE_EMAIL_SERVICE, ROXY_CDP_ENABLED,
)
from core.session import BrowserSession
from core.chatgpt_auth import get_providers, get_csrf_token, signin_openai
from core.openai_auth import (
    follow_authorize,
    follow_auth_continue,
    get_create_account_page,
    request_sentinel_token,
    build_sentinel_header,
    register_user,
    validate_email_otp,
    EmailOtpRejectedError,
    create_account,
)
from core.account_export import (
    follow_oauth_callback,
    fetch_session,
    setup_2fa,
    save_account_data,
    create_batch_archive_dir,
)
from core.email_provider import (
    acquire_email,
    close as close_email_provider,
    mark_registration_success,
    wait_for_otp,
)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_FINALIZE_SESSION_MAX_ATTEMPTS = 5
_FINALIZE_SESSION_BACKOFF_BASE = 2.0


def resolve_registration_password(env: dict | None = None) -> str:
    """读取协议注册必须提交的补号账号密码。"""
    values = os.environ if env is None else env
    password = str(values.get("ROXY_REGISTER_PASSWORD") or "").strip()
    if not password:
        raise RuntimeError("ROXY_REGISTER_PASSWORD 未配置，协议注册无法设置账号密码")
    return password


def validate_otp_with_retry(session, email: str, after_ts: float, sentinel_header: str) -> dict:
    """错码后只接受本次尝试之后到达的新邮件，避免重复提交旧 OTP。"""
    marker = after_ts
    rejected_codes = set()
    while True:
        code = wait_for_otp(email, after_ts=marker, excluded_codes=rejected_codes)
        try:
            return validate_email_otp(session, code, sentinel_header)
        except EmailOtpRejectedError:
            rejected_codes.add(code)
            marker = time.time()
            logger.warning("[OTP] 当前验证码被拒绝，继续每 5 秒轮询新邮件")


def _sync_replacement_registration_status(email: str) -> None:
    """注册成功后同步补号账号状态；同步失败不覆盖已保存的本地账号。"""
    from config import EMAIL_SOURCE

    if EMAIL_SOURCE != "replacement":
        return
    try:
        mark_registration_success(email)
        logger.info("[邮箱] 补号数据库状态已同步为 registered")
    except Exception as exc:
        logger.warning(
            "[邮箱] 补号数据库状态回写失败：%s: %s",
            type(exc).__name__,
            str(exc)[:160],
        )


def configure_logging(verbose: bool = False) -> None:
    """配置 CLI 日志：默认简洁，--verbose 时显示完整步骤细节。"""
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    for handler in root.handlers:
        handler.setLevel(logging.DEBUG if verbose else logging.INFO)

    if verbose:
        logging.getLogger("core").setLevel(logging.DEBUG)
        return

    logging.getLogger("core").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("requests").setLevel(logging.WARNING)


def _is_success(result: dict) -> bool:
    """判断单次注册结果是否成功，集中收敛批量统计规则。"""
    return isinstance(result, dict) and bool(result.get("success"))


def registration_status_ready(totp_secret: str | None) -> bool:
    """只有 2FA 已激活时，协议注册才允许回写 replacement registered。"""
    if not ENABLE_2FA:
        return True
    return bool(str(totp_secret or "").strip())


def emit_registration_result(results: list[dict]) -> None:
    """按父服务约定输出机器结果；默认不向 stdout 输出敏感结果。"""
    enabled = os.environ.get("REGISTRATION_RESULT_JSON", "").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        return

    successful_result = next(
        (result for result in reversed(results) if _is_success(result)),
        None,
    )
    if not successful_result:
        return

    secret = str(successful_result.get("totp_secret") or "").strip()
    payload = {
        "registrationMfa": (
            {"secret": secret, "enabled": True}
            if secret
            else None
        ),
    }
    print(
        "ROXY_REGISTER_RESULT_JSON="
        + json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        flush=True,
    )


def _finalize_registration_session(
    session: BrowserSession,
    continue_url: str,
    email: str,
) -> tuple[dict, str]:
    """
    完成 OAuth 回调并拉取 accessToken。

    create_account 返回只代表创建接口通过，真正可用必须等 chatgpt.com
    写入登录态 cookie 且 /api/auth/session 返回 accessToken。
    """
    if not continue_url:
        raise RuntimeError("create_account 响应缺少 continue_url，无法完成 OAuth 回调")

    last_exc: Exception | None = None
    for attempt in range(1, _FINALIZE_SESSION_MAX_ATTEMPTS + 1):
        try:
            logger.info(
                f"[登录态] 完成 OAuth 回调并拉取 Token：{email} "
                f"(尝试 {attempt}/{_FINALIZE_SESSION_MAX_ATTEMPTS})"
            )
            follow_oauth_callback(session, continue_url)
            time.sleep(1)
            session_info = fetch_session(session)
            access_token = session_info.get("accessToken")
            if not access_token:
                raise RuntimeError("session 响应缺少 accessToken")
            logger.info(f"[登录态] 已拿到 accessToken：{email}")
            return session_info, access_token
        except Exception as exc:
            last_exc = exc
            if attempt >= _FINALIZE_SESSION_MAX_ATTEMPTS:
                break
            backoff = _FINALIZE_SESSION_BACKOFF_BASE ** (attempt - 1)
            logger.warning(
                f"[登录态] 回调或拉取 Token 失败：{email}，"
                f"{type(exc).__name__}: {str(exc)[:180]}，{backoff:.1f}s 后重试"
            )
            time.sleep(backoff)

    raise RuntimeError(
        f"OAuth 回调/拉取 Token 重试耗尽：{email}，"
        f"最后错误：{type(last_exc).__name__ if last_exc else 'Unknown'}: {last_exc}"
    ) from last_exc


def generate_display_name() -> str:
    """生成只包含英文字母和空格的显示名，符合注册接口限制。"""
    first = random.choice(string.ascii_uppercase) + "".join(
        random.choices(string.ascii_lowercase, k=random.randint(3, 6))
    )
    last = random.choice(string.ascii_uppercase) + "".join(
        random.choices(string.ascii_lowercase, k=random.randint(3, 6))
    )
    return f"{first} {last}"


def prepare_registration_inputs() -> tuple[str, str, str]:
    """按 CLI 规则准备一次注册所需的邮箱、显示名和生日。"""
    email = REGISTER_EMAIL
    name = REGISTER_NAME
    birthday = REGISTER_BIRTHDAY

    # 邮箱：留空 + USE_EMAIL_SERVICE=True 时从 Outlook 池领取
    if not email:
        if USE_EMAIL_SERVICE:
            email = acquire_email()
            logger.debug(f"自动获取邮箱: {email}")
        else:
            email = input("请输入注册邮箱: ").strip()

    # 显示名称：未填则随机生成
    # OpenAI 限制：name_invalid_chars —— 只允许字母和空格，不能含数字/标点
    if not name:
        if USE_EMAIL_SERVICE:
            name = generate_display_name()
            logger.debug(f"自动生成显示名称: {name}")
        else:
            name = input("请输入显示名称: ").strip()

    if not all([email, name]):
        raise RuntimeError("邮箱和名称不能为空")

    return email, name, birthday


def run_registration(
    email: str,
    name: str,
    birthday: str = "2000-01-01",
    proxy: str = None,
    otp_code: str = None,
    batch_dir=None,
):
    """
    执行完整的 ChatGPT 密码注册流程。

    流程：signup authorize → 创建密码 → 邮箱 OTP → about-you → 完成。

    Args:
        email: 注册邮箱
        name: 用户显示名称
        birthday: 生日，格式 YYYY-MM-DD
        proxy: 代理地址（不传则从 PROXY_POOL 随机抽）
        otp_code: 邮箱验证码（如果为None，会等待手动输入）
    """
    registration_password = resolve_registration_password()

    # 创建浏览器会话（proxy=None 时自动从 config.PROXY_POOL 随机抽一个）
    session = BrowserSession(proxy=proxy)

    # 从代理 URL 中抽取 sid 段做日志，避免把账号密码完整打印
    proxy_label = "无"
    if session.proxy:
        # 形如 socks5h://user-region-JP-sid-XXXX-t-5:pass@host:port
        try:
            sid_part = next(
                (seg for seg in session.proxy.split("@")[0].split("-") if len(seg) == 8),
                "***",
            )
            proxy_label = f"{session.proxy.split('://')[0]}://...sid-{sid_part}...@{session.proxy.split('@')[-1]}"
        except Exception:
            proxy_label = "已配置"

    logger.info(f"[注册] 开始：{email}，代理={proxy_label}")
    logger.debug(f"[注册] 设备ID={session.device_id}，会话日志ID={session.auth_session_logging_id}")

    create_acknowledged = False
    registration_status_attempted = False
    totp_secret = None
    try:
        # ==================== 阶段1: ChatGPT 认证 ====================
        # 步骤1: 获取 providers
        providers = get_providers(session)
        time.sleep(0.5)

        # 步骤2: 获取 CSRF token
        csrf_token = get_csrf_token(session)
        time.sleep(0.5)

        # 步骤3: 发起 OAuth signin
        authorize_url = signin_openai(
            session,
            csrf_token,
            email,
            screen_hint="login_or_signup",
            prompt="login",
            include_login_hint=True,
        )
        time.sleep(0.5)

        # 记录"OTP 触发"前的时间戳，自动取信箱时只看此后的邮件，
        # 避免取到上次注册留下的旧 OTP。
        otp_after_ts = time.time()

        # ==================== 阶段2: OpenAI Auth ====================
        # 步骤4: 跟随 authorize URL（建立 auth.openai.com 的 cookies）
        follow_authorize(session, authorize_url)
        time.sleep(2)

        # 初始 email-verification 是页面过渡，不能在此调用 OTP validate。
        # 真实服务端仅在密码提交后返回 email_otp_send。
        logger.info("[步骤5] Auth 会话已建立，进入创建密码阶段")
        get_create_account_page(session)
        time.sleep(0.5)

        # ==================== 阶段3: 设置密码 ====================
        sentinel_resp_7 = request_sentinel_token(session, "username_password_create")
        sentinel_header_7, so_header_7 = build_sentinel_header(
            session, sentinel_resp_7, "username_password_create"
        )
        register_result = register_user(
            session, email, registration_password, sentinel_header_7, so_header_7
        )

        password_page = str(register_result.get("page", {}).get("type") or "")
        if password_page == "about_you":
            follow_auth_continue(session, register_result, "about_you")
        elif password_page in {"email_otp_send", "email_otp_verification"}:
            # 标准密码注册会在提交密码后验证邮箱；旧邮件不能复用。
            follow_auth_continue(session, register_result, ("email_otp_send", "email_otp_verification"))
            sentinel_resp_post_password = request_sentinel_token(session, "authorize_continue")
            sentinel_header_post_password, _ = build_sentinel_header(
                session, sentinel_resp_post_password, "authorize_continue"
            )
            if USE_EMAIL_SERVICE:
                logger.info(f"[OTP] 等待验证码：{email}")
                otp_code_post_password = otp_code
            else:
                logger.info("[OTP] 密码提交后需要邮箱验证码:")
                otp_code_post_password = otp_code or input(">>> 验证码: ").strip()
            post_password_result = validate_otp_with_retry(
                session, email, time.time(), sentinel_header_post_password
            ) if otp_code is None else validate_email_otp(session, otp_code_post_password, sentinel_header_post_password)
            follow_auth_continue(session, post_password_result, "about_you")
        else:
            raise RuntimeError(
                f"密码提交后 Auth 阶段错误：期望 about_you 或 email_otp_*，实际 {password_page or 'unknown'}"
            )
        time.sleep(0.5)

        # ==================== 阶段5: 完成注册 ====================
        # 步骤11: 获取 Sentinel Token（oauth_create_account）
        sentinel_resp_11 = request_sentinel_token(session, "oauth_create_account")
        sentinel_header_11, so_header_11 = build_sentinel_header(session, sentinel_resp_11, "oauth_create_account")
        time.sleep(0.3)

        # 步骤12: 提交用户信息，完成注册
        create_result = create_account(session, name, birthday, sentinel_header_11, so_header_11)
        create_acknowledged = True

        logger.info(f"[注册] 创建接口已通过：{email}，继续完成 OAuth 回调")
        time.sleep(1)

        # ==================== 阶段6: OAuth 回调与登录态建立 ====================
        # 步骤12.5: 跟随 continue_url 完成 OAuth 回调
        # 这一步 chatgpt.com 才会设置 __Secure-next-auth.session-token cookie，
        # 之后 /api/auth/session 才能返回真正的 accessToken。
        continue_url = create_result.get("continue_url")
        if not continue_url:
            raise RuntimeError(
                f"create_account 响应缺少 continue_url，无法继续: {create_result}"
            )

        # 步骤13: 拉 /api/auth/session 提取 accessToken
        session_info, access_token = _finalize_registration_session(session, continue_url, email)
        time.sleep(1)

        # ==================== 阶段7: 设置 2FA（受 config.ENABLE_2FA 控制）====================
        if ENABLE_2FA:
            # 直接复用注册后的 accessToken，不触发二次邮箱验证码或 password re-auth。
            try:
                totp_secret = setup_2fa(session, email, access_token=access_token)
            except Exception as exc:
                logger.error(f"2FA 设置失败: {exc}")
                logger.debug("2FA 错误详情:", exc_info=True)
                logger.warning("将继续保存账号信息（不含 TOTP secret），可后续手动设置")
        else:
            logger.debug("已跳过 2FA 设置 (config.ENABLE_2FA=False)")

        # ==================== 阶段8: 持久化账号 ====================
        from config import EMAIL_SOURCE
        account_id = save_account_data(
            email=email,
            access_token=access_token,
            totp_secret=totp_secret,
            email_source=EMAIL_SOURCE,
            proxy_used=session.proxy or None,
            batch_dir=batch_dir,
            extra={
                "user": session_info.get("user"),
                "account": session_info.get("account"),
                "expires": session_info.get("expires"),
                "device_id": session.device_id,
            },
        )

        if registration_status_ready(totp_secret):
            _sync_replacement_registration_status(email)
            registration_status_attempted = True
        else:
            logger.warning(
                "[邮箱] 2FA 未激活，暂不将补号数据库状态同步为 registered"
            )

        logger.info(f"[完成] {email}，账号ID={account_id}，Token={access_token[:16]}...")

        # ==================== 阶段9: 后置自动触发 flow ====================
        # 只有走完回调、拿到 token 并保存成功的账号，才会触发 flow。
        # flow 请求不影响账号保存状态，但会记录结果并参与批量统计。
        flow_result = {"status": "skipped", "ok": False, "message": "未触发"}
        try:
            from core.flow_trigger import trigger_flow
            flow_result = trigger_flow(access_token)
        except Exception as exc:
            flow_result = {"status": "failed", "ok": False, "message": f"{type(exc).__name__}: {exc}"}

        if flow_result.get("ok"):
            logger.info(
                f"[Flow] 成功：{email}，HTTP={flow_result.get('http_status')}, "
                f"flow_id={flow_result.get('flow_id') or '未解析'}"
            )
        elif flow_result.get("status") == "skipped":
            logger.info(f"[Flow] 跳过：{email}，原因={flow_result.get('message')}")
        else:
            logger.warning(
                f"[Flow] 失败：{email}，HTTP={flow_result.get('http_status') or '无'}, "
                f"原因={flow_result.get('message')}"
            )

        logger.debug("[完成] TOTP 已设置：%s", bool(totp_secret))

        return {"success": True, "email": email, "account_id": account_id,
                "access_token": access_token, "totp_secret": totp_secret,
                "flow": flow_result}

    except Exception as e:
        logger.error(f"[失败] {email}: {type(e).__name__}: {e}")
        logger.debug("详细错误信息:", exc_info=True)
        # 创建接口通过前失败：邮箱还可以下次继续尝试。
        # 创建接口通过后失败：远端已消耗这个邮箱，直接废弃，避免重复注册。
        try:
            from config import EMAIL_SOURCE as _src
            if (
                _src == "replacement"
                and create_acknowledged
                and not registration_status_attempted
                and registration_status_ready(totp_secret)
            ):
                _sync_replacement_registration_status(email)
                registration_status_attempted = True
            if _src == "outlook" and email:
                from core.outlook_client import release_account
                if create_acknowledged:
                    release_account(
                        email,
                        status="failed",
                        note=f"创建接口已通过但后续失败，已废弃: {str(e)[:180]}",
                    )
                    logger.warning(f"[邮箱] {email} 已创建但后续失败，标记为 failed，不再重新注册")
                else:
                    release_account(email, status="available", note=f"上次失败: {str(e)[:180]}")
        except Exception:
            pass
        return {"success": False, "email": email, "error": str(e)}
    finally:
        try:
            session.close()
        except Exception as close_error:
            logger.debug(f"[注册] 关闭浏览器会话失败: {close_error}")
        try:
            close_email_provider()
        except Exception as close_error:
            logger.debug(f"[注册] 关闭邮箱服务 bridge 失败: {close_error}")


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="ChatGPT 协议注册 CLI")
    parser.add_argument("-n", "--count", type=int, default=1, help="连续注册数量，默认 1")
    parser.add_argument("--workers", type=int, default=1, help="并发注册线程数，默认 1（串行）")
    parser.add_argument("--delay", type=float, default=0, help="每次注册结束后的间隔秒数")
    parser.add_argument("--continue-on-fail", action="store_true", help="单个账号失败后继续注册下一个")
    parser.add_argument("--verbose", action="store_true", help="显示详细步骤日志和错误堆栈")
    args = parser.parse_args()
    configure_logging(args.verbose)

    if args.count < 1:
        logger.error("注册数量必须大于 0")
        sys.exit(1)

    if args.workers < 1:
        logger.error("并发线程数必须大于 0")
        sys.exit(1)

    if ROXY_CDP_ENABLED and args.workers != 1:
        logger.error("Roxy CDP 当前复用单个 profile，只支持 --workers 1；请不要并发共享同一浏览器上下文")
        sys.exit(1)

    if args.count > 1 and REGISTER_EMAIL:
        logger.error("config.REGISTER_EMAIL 已固定邮箱，不适合批量注册；请留空后再使用 --count")
        sys.exit(1)

    if args.workers > 1 and not USE_EMAIL_SERVICE:
        logger.error("多线程注册需要启用 Outlook 自动取件；请开启 USE_EMAIL_SERVICE 或改用 --workers 1")
        sys.exit(1)

    if args.workers > args.count:
        logger.info(f"[批量] 并发线程数 {args.workers} 大于目标数量，已按 {args.count} 个任务执行")
        args.workers = args.count

    if args.workers > 1:
        batch_dir = create_batch_archive_dir(args.count, args.workers)
        logger.info(f"[批量] 本批次归档目录：{batch_dir}")
        results = run_parallel_batch(args.count, args.workers, args.delay, args.continue_on_fail, batch_dir)
    else:
        batch_dir = create_batch_archive_dir(args.count, args.workers)
        logger.info(f"[批量] 本批次归档目录：{batch_dir}")
        results = run_serial_batch(args.count, args.delay, args.continue_on_fail, batch_dir)

    success_count = sum(1 for r in results if _is_success(r))
    flow_success_count = sum(
        1 for r in results
        if _is_success(r) and isinstance(r.get("flow"), dict) and r["flow"].get("ok")
    )
    flow_failed_count = sum(
        1 for r in results
        if _is_success(r)
        and isinstance(r.get("flow"), dict)
        and r["flow"].get("status") == "failed"
    )
    flow_skipped_count = sum(
        1 for r in results
        if _is_success(r)
        and isinstance(r.get("flow"), dict)
        and r["flow"].get("status") == "skipped"
    )
    logger.info(f"[批量] 完成：成功 {success_count} / 尝试 {len(results)} / 目标 {args.count}")
    if success_count:
        logger.info(
            f"[批量] Flow：成功 {flow_success_count} / 失败 {flow_failed_count} / 跳过 {flow_skipped_count}"
        )
    emit_registration_result(results)
    sys.exit(0 if success_count == args.count else 1)


def run_one_batch_item(index: int, total: int, batch_dir=None) -> dict:
    """执行批量注册中的一个任务，返回结构化结果。"""
    logger.info(f"[批量] 开始第 {index + 1}/{total} 个注册")
    try:
        email, name, birthday = prepare_registration_inputs()
        return run_registration(
            email=email,
            name=name,
            birthday=birthday,
            batch_dir=batch_dir,
            # proxy 不传 → BrowserSession 会从 PROXY_POOL 随机抽
        )
    except Exception as exc:
        logger.error(f"[批量] 第 {index + 1} 个注册准备阶段失败: {type(exc).__name__}: {exc}")
        logger.debug("准备阶段错误详情:", exc_info=True)
        return {"success": False, "error": str(exc)}


def run_serial_batch(count: int, delay: float, continue_on_fail: bool, batch_dir=None) -> list[dict]:
    """按原有串行方式执行批量注册。"""
    results = []
    for index in range(count):
        result = run_one_batch_item(index, count, batch_dir)
        results.append(result)
        if not _is_success(result) and not continue_on_fail:
            logger.error("[批量] 当前账号失败，已停止。需要继续跑可加 --continue-on-fail")
            break

        if delay > 0 and index < count - 1:
            logger.info(f"[批量] 等待 {delay} 秒后继续")
            time.sleep(delay)
    return results


def run_parallel_batch(
    count: int,
    workers: int,
    delay: float,
    continue_on_fail: bool,
    batch_dir=None,
) -> list[dict]:
    """使用线程池并发执行批量注册。"""
    logger.info(f"[批量] 启用多线程注册：目标 {count}，并发 {workers}")
    if delay > 0:
        logger.info(f"[批量] 并发模式下 --delay={delay} 表示提交任务之间的错峰间隔")

    results: list[dict] = []
    future_to_index = {}
    next_index = 0
    stop_submitting = False

    def submit_next(executor: ThreadPoolExecutor) -> bool:
        nonlocal next_index
        if stop_submitting or next_index >= count:
            return False
        future = executor.submit(run_one_batch_item, next_index, count, batch_dir)
        future_to_index[future] = next_index
        next_index += 1
        if delay > 0 and next_index < count:
            time.sleep(delay)
        return True

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="reg-cli") as executor:
        while len(future_to_index) < workers and submit_next(executor):
            pass

        while future_to_index:
            done, _ = wait(future_to_index, return_when=FIRST_COMPLETED)
            for future in done:
                index = future_to_index.pop(future)
                try:
                    result = future.result()
                except Exception as exc:
                    logger.error(f"[批量] 第 {index + 1}/{count} 个注册线程异常: {type(exc).__name__}: {exc}")
                    logger.debug("线程错误详情:", exc_info=True)
                    result = {"success": False, "error": str(exc)}
                results.append(result)

                if not _is_success(result) and not continue_on_fail:
                    stop_submitting = True
                    logger.error("[批量] 当前账号失败，已停止提交新任务。已开始的任务会继续跑完。")

            while len(future_to_index) < workers and submit_next(executor):
                pass

    return results


if __name__ == "__main__":
    main()
