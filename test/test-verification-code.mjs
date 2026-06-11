const baseUrl = 'http://localhost:3100';

const adminPassword = 'admin'; // 如果 .env 里改了 ADMIN_PASSWORD，这里同步改
const targetAccount = 'huynhyeu94+s1@gmail.com';

async function main() {
  // 1. 登录后台，拿 admin_auth cookie
  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      password: adminPassword,
    }),
    redirect: 'manual',
  });

  const cookies = loginResponse.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

  if (!cookies) {
    throw new Error('登录失败：没有拿到 cookie，请检查 ADMIN_PASSWORD');
  }

  // 2. 调用验证码接口
  const response = await fetch(`${baseUrl}/api/verification-code/latest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookies,
    },
    body: JSON.stringify({
      account: targetAccount,
    }),
  });

  const result = await response.json();
  const safeResult = {
    ...result,
    code: result?.code ? '[redacted-6-digit]' : result?.code,
  };

  console.log('HTTP status:', response.status);
  console.log(JSON.stringify(safeResult, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
