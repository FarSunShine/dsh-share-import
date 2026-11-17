# 在国内稳定地连 GitHub（本机备注）

直连 `github.com:443` 会间歇性被重置：同一分钟里 `git push` 可能连续两次
`Failed to connect to github.com:443`，第三次又成功。而 `api.github.com`、
`codeload.github.com`、`raw.githubusercontent.com` 一直稳定，`ssh.github.com:443`
和 `github.com:22` 也稳定。

所以本机不再走 HTTPS 的 git 传输，改成 **SSH over 443**。

## 配置

`~/.ssh/config`：

```
Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 3
  TCPKeepAlive yes
```

- 把 `github.com` 映射到 `ssh.github.com:443`：URL 仍是标准的
  `git@github.com:owner/repo.git`，实际连 443 端口上的 SSH 入口，绕开会被重置的 HTTPS。
- `ServerAliveInterval` 让长连接不会中途静默断开。
- 密钥是 ed25519。Windows 上若 `~` 展开不生效，把 `IdentityFile` 写成绝对路径
  （`C:/Users/<you>/.ssh/id_ed25519`）。

自检：

```bash
ssh -T git@github.com
# Hi <owner>/<repo>! You've successfully authenticated, ...
```

远端用 SSH：

```bash
git remote set-url origin git@github.com:<owner>/<repo>.git
```

## 两种密钥，按需要选

- **部署密钥（deploy key，读写）**：只对单个仓库有效，GitHub 仓库 Settings → Deploy keys。
- **账号级 SSH key**：对全部仓库有效，GitHub Settings → SSH and GPG keys。
  想让 fork、其他项目也能推，就把同一把公钥加到账号级。

## 推送失败时重试

重置是间歇性的，重试通常就能过：

```bash
git config --global alias.pushr '!git push || git push || git push'
git pushr
```

## 启用代理时（可选）

```bash
git config --global http.https://github.com.proxy http://127.0.0.1:10808
```

SSH 走代理则在 `Host github.com` 里加 `ProxyCommand connect -H 127.0.0.1:10808 %h %p`。
关掉代理后：

```bash
git config --global --unset http.https://github.com.proxy
```

## 应急通道：走 API 提交

HTTPS 和 SSH 都不通、但 `api.github.com` 还能连时，可以直接用 GitHub REST API
建 blob/tree/commit/ref 完成提交，只依赖 api.github.com，历史上最稳。

## 排障顺序

1. `Test-NetConnection github.com -Port 443`
2. `Test-NetConnection ssh.github.com -Port 443`
3. `ssh -vT git@github.com`，看密钥是否被 offer、是否被接受
4. 都不通再考虑开代理
