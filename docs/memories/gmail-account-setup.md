# Gmail IMAP 账号准备流程

本文档说明在本地 Gmail IMAP 服务中添加账号前，需要先在 Google/Gmail 侧确认的设置。

官方参考：

- Gmail 添加到其他电子邮件客户端：https://support.google.com/mail/answer/7126229?hl=zh-Hans
- Google 应用专用密码：https://support.google.com/accounts/answer/185833?hl=zh-Hans

## 1. 先确认 Gmail IMAP 状态

Google 官方文档说明：对于个人 Google 账号，自 2025 年 1 月起，Gmail 的“启用 IMAP / 停用 IMAP”选项不再可用，IMAP 访问功能会始终处于启用状态。

也就是说：

- 如果是个人 Gmail，通常不需要再手动开启 IMAP。
- 如果是公司/学校/组织的 Google Workspace 账号，管理员策略可能会影响相关设置。
- 如果你仍然能看到 Gmail 的 IMAP 设置页，可以按下面步骤检查。

检查路径：

1. 打开 Gmail：

   ```text
   https://mail.google.com/
   ```

2. 点击右上角齿轮图标。

3. 点击：

   ```text
   查看所有设置
   ```

4. 进入：

   ```text
   转发和 POP/IMAP
   ```

5. 查看：

   ```text
   IMAP 访问
   ```

6. 如果页面有“启用 IMAP”选项，就选择启用并保存更改。

7. 如果没有“启用 IMAP”选项，个人 Gmail 账号通常是正常情况。

## 2. 开启两步验证

App Password 只能在已开启两步验证的 Google 账号上创建。

步骤：

1. 打开 Google 账号安全页：

   ```text
   https://myaccount.google.com/security
   ```

2. 找到：

   ```text
   登录 Google 的方式
   ```

3. 进入：

   ```text
   两步验证
   ```

4. 按 Google 页面提示完成两步验证设置。

## 3. 创建 App Password

步骤：

1. 打开应用专用密码页面：

   ```text
   https://myaccount.google.com/apppasswords
   ```

2. 如果系统要求登录，先登录当前 Gmail 对应的 Google 账号。

3. 创建一个新的应用专用密码。

4. 名称建议填写：

   ```text
   gmail-imap-service
   ```

5. Google 会生成一个 16 位 App Password。

6. 复制这个 16 位密码。

示例格式：

```text
abcd efgh ijkl mnop
```

本项目会自动去掉中间空格，所以填下面两种都可以：

```text
abcd efgh ijkl mnop
abcdefghijklmnop
```

## 4. 在本服务里添加账号

后台添加邮箱时填写：

```text
Gmail 邮箱号
Gmail 登录密码
2FA
App Password
```

实际 IMAP 获取邮件只使用：

```text
Gmail 邮箱号 + App Password
```

`Gmail 登录密码` 和 `2FA` 是按当前本地管理需求存档展示，不用于 IMAP 登录。

## 5. 使用 Gmail `+tag` 别名获取验证码

数据库只需要保存主 Gmail 账号，例如：

```text
jregkolpig@gmail.com
```

主账号的 App Password 也只需要配置一次。

调用验证码接口时可以传任意 Gmail `+tag` 别名：

```json
{
  "account": "jregkolpig+s2@gmail.com"
}
```

服务会自动：

```text
jregkolpig+s2@gmail.com -> jregkolpig@gmail.com
```

然后使用主账号连接 Gmail IMAP，并只返回投递到 `jregkolpig+s2@gmail.com` 的最新 6 位验证码邮件。

## 6. 如果仍然显示认证失败

页面提示：

```text
Gmail 认证失败
```

常见原因：

1. App Password 填错。
2. App Password 已被撤销。
3. Google 账号密码改过，旧 App Password 被撤销。
4. 复制 App Password 时漏字符。
5. 使用的 Gmail 邮箱和生成 App Password 的 Google 账号不一致。
6. 公司/学校 Workspace 管理员禁用了 App Password 或相关访问。
7. 账号加入了高级保护计划，导致 App Password 不可用。

建议处理：

1. 删除旧 App Password。
2. 重新生成一个新的 App Password。
3. 在本服务里编辑该邮箱账号，替换新的 App Password。
4. 点击“测试连接”。
