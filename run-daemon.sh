#!/bin/bash
# NapCat-OpenClaw Bridge 守护进程脚本
# 用于 systemd 服务或手动运行

LOG_FILE="./bridge.log"
PID_FILE="./bridge.pid"

# 加载配置文件（如果存在）
if [ -f "$(dirname "$0")/config.env" ]; then
    set -a
    source "$(dirname "$0")/config.env"
    set +a
fi

# 配置（按需修改）
export NAPCAT_HOST="${NAPCAT_HOST:-127.0.0.1}"
export NAPCAT_PORT="${NAPCAT_PORT:-3001}"
export NAPCAT_TOKEN="${NAPCAT_TOKEN:-YOUR_NAPCAT_TOKEN}"
export OPENCLAW_HOST="${OPENCLAW_HOST:-localhost}"
export OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
export OPENCLAW_TOKEN="${OPENCLAW_TOKEN:-YOUR_OPENCLAW_TOKEN}"
export IMG_DIR="${IMG_DIR:-./images}"
export FILE_DIR="${FILE_DIR:-./files}"

# 确保目录存在
mkdir -p "$IMG_DIR" "$FILE_DIR"

# 如果有 PID 文件且进程在跑，直接退出（防止重复启动）
if [ -f $PID_FILE ] && kill -0 $(cat $PID_FILE) 2>/dev/null; then
    echo "桥接已在运行 (PID: $(cat $PID_FILE))"
    exit 0
fi

start_daemon() {
    echo "[$(date)] 🌟 桥接守护进程启动" >> $LOG_FILE
    
    while true; do
        echo "[$(date)] 启动桥接..." >> $LOG_FILE
        echo "[$(date)] 配置: NapCat=${NAPCAT_HOST}:${NAPCAT_PORT} OpenClaw=http://${OPENCLAW_HOST}:${OPENCLAW_PORT}" >> $LOG_FILE
        
        node bridge.js >> $LOG_FILE 2>&1
        
        EXIT_CODE=$?
        echo "[$(date)] 桥接退出 (code=$EXIT_CODE)，10秒后重连..." >> $LOG_FILE
        sleep 10
    done
}

start_fork() {
    start_daemon &
    echo $! > $PID_FILE
    echo "启动成功 (PID: $(cat $PID_FILE))"
}

stop() {
    if [ -f $PID_FILE ]; then
        kill $(cat $PID_FILE) 2>/dev/null
        rm $PID_FILE
        echo "已停止"
    else
        echo "未运行"
    fi
}

status() {
    if [ -f $PID_FILE ] && kill -0 $(cat $PID_FILE) 2>/dev/null; then
        echo "运行中 (PID: $(cat $PID_FILE))"
    else
        echo "未运行"
    fi
}

case "$1" in
    start)
        start_fork
        ;;
    start-daemon)
        start_daemon
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        stop
        sleep 1
        start_fork
        ;;
    *)
        echo "用法: $0 {start|start-daemon|stop|restart|status}"
        exit 1
        ;;
esac
