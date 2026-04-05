# NapCatQQ ↔ OpenClaw 桥接部署指南

## 环境要求

- Node.js 16+
- NapCatQQ 已运行并配置好 WebSocket
- OpenClaw 已运行

## 快速开始

### 1. 解压桥接包

```bash
unzip napcat-bridge-package.zip
cd napcat-bridge-package
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置连接参数

编辑 `config.env` 或设置环境变量：

```bash
# NapCatQQ 配置
NAPCAT_HOST=127.0.0.1        # NapCatQQ 地址（通常不变）
NAPCAT_PORT=3001             # NapCatQQ WebSocket 端口
NAPCAT_TOKEN=YOUR_NAPCAT_TOKEN # NapCatQQ token

# OpenClaw 配置
OPENCLAW_HOST=172.18.0.1      # OpenClaw Docker 网关 IP
OPENCLAW_PORT=18789           # OpenClaw Gateway 端口
OPENCLAW_TOKEN=YOUR_OPENCLAW_TOKEN
```

### 4. 启动

```bash
# 前台运行（测试用）
npm start

# 后台守护运行
bash run-daemon.sh start

# 查看状态
bash run-daemon.sh status

# 停止
bash run-daemon.sh stop
```

## 配置说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| NAPCAT_HOST | 127.0.0.1 | NapCatQQ WebSocket 地址 |
| NAPCAT_PORT | 3001 | NapCatQQ WebSocket 端口 |
| NAPCAT_TOKEN | (见 config) | NapCatQQ 访问令牌 |
| OPENCLAW_HOST | 172.18.0.1 | OpenClaw 网关地址 |
| OPENCLAW_PORT | 18789 | OpenClaw Gateway 端口 |
| OPENCLAW_TOKEN | (见 config) | OpenClaw 访问令牌 |
| IMG_DIR | ./images | 图片保存目录 |
| FILE_DIR | ./files | 文件保存目录 |

## 开机自启

### Linux (systemd)

创建 `/etc/systemd/system/napcat-bridge.service`:

```ini
[Unit]
Description=NapCat-OpenClaw Bridge
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/path/to/napcat-bridge-package
ExecStart=/path/to/napcat-bridge-package/run-daemon.sh start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable napcat-bridge
sudo systemctl start napcat-bridge
```

### macOS (launchd)

创建 `~/Library/LaunchAgents/com.napcat-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <label>com.napcat-bridge</label>
    <programArguments>/path/to/napcat-bridge-package/run-daemon.sh start</programArguments>
    < WorkingDirectory>/path/to/napcat-bridge-package</WorkingDirectory>
    <RunAtLoad/>
    <KeepAlive/>
</dict>
</plist>
```

然后：
```bash
launchctl load ~/Library/LaunchAgents/com.napcat-bridge.plist
```

## 排查问题

### 看不到 OpenClaw

确保 OpenClaw 的 18789 端口已映射到宿主机：

```bash
# 检查 Docker 端口映射
docker ps | grep openclaw
```

### NapCatQQ 连接失败

确认 NapCatQQ 的 WebSocket 服务已开启，端口和 token 正确。

### 日志位置

桥接日志输出到 `./bridge.log`，运行时日志会持续追加。
