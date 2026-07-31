"""手动验证协议注册 AT 文件保存；不会联网或启动注册流程。"""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.account_export import save_registration_access_token_file


# 填写后直接运行此文件。每次运行会覆盖同邮箱对应的 <email>.txt。
TEST_EMAIL = ""
TEST_ACCESS_TOKEN = ""
OUTPUT_DIR = PROJECT_ROOT.parent / "product_files" / "registration"


def main() -> None:
    email = TEST_EMAIL.strip()
    access_token = TEST_ACCESS_TOKEN.strip()
    if not email:
        raise ValueError("请先填写 TEST_EMAIL")
    if not access_token:
        raise ValueError("请先填写 TEST_ACCESS_TOKEN")

    saved_path = save_registration_access_token_file(
        email=email,
        access_token=access_token,
        output_dir=OUTPUT_DIR,
    )
    if not saved_path:
        raise RuntimeError("AT 文件未写入")

    content = Path(saved_path).read_text(encoding="utf-8")
    if content != access_token:
        raise RuntimeError("AT 写入后校验失败")

    print(f"AT 保存成功: {saved_path}")
    print(f"长度校验通过: {len(access_token)}")


if __name__ == "__main__":
    main()
