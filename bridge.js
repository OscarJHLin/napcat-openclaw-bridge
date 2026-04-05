#!/usr/bin/env node
/**
 * NapCatQQ ↔ OpenClaw Bridge (支持图片/文件)
 * 
 * WebSocket 接收消息 → OpenClaw HTTP → WebSocket 发送回复
 * 支持图片/文件下载
 */

const { WebSocket } = require('./ws');

// ============ 配置 ============
const NAPCAT_HOST = process.env.NAPCAT_HOST || '127.0.0.1';
const NAPCAT_PORT = process.env.NAPCAT_PORT || '3001';
const NAPCAT_TOKEN = process.env.NAPCAT_TOKEN || 'YOUR_NAPCAT_TOKEN';
const OPENCLAW_HOST = process.env.OPENCLAW_HOST || 'localhost';
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || '18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || 'YOUR_OPENCLAW_TOKEN';

const OPENCLAW_API = `http://${OPENCLAW_HOST}:${OPENCLAW_PORT}`;
const IMG_DIR = process.env.IMG_DIR || './images/';
const FILE_DIR = process.env.FILE_DIR || './files/';

// ============ 状态 ============
let napcatWs = null;
let connected = false;
let requestId = 0;
const pendingRequests = new Map();

// ============ 工具函数 ============
function log(type, msg) {
  const time = new Date().toISOString().substring(11, 19);
  console.log(`[${time}] [${type}] ${msg}`);
}

function nextEcho() {
  return `bridge-${++requestId}-${Date.now()}`;
}

function extractMessageParts(message) {
  if (!message) return { text: '', images: [], files: [] };
  if (typeof message === 'string') {
    return { text: message.trim(), images: [], files: [] };
  }
  if (!Array.isArray(message)) return { text: String(message), images: [], files: [] };
  
  let text = '';
  const images = [];
  const files = [];
  
  for (const m of message) {
    if (typeof m === 'string') {
      text += m;
    } else if (m.type === 'text') {
      text += m.data?.text || '';
    } else if (m.type === 'image') {
      images.push({
        file_id: m.data?.file_id || m.data?.id || m.data?.file || '',
        file: m.data?.file || '',
        url: m.data?.url || '',
        name: m.data?.name || m.data?.file || 'image.jpg'
      });
    } else if (m.type === 'file') {
      files.push({
        file_id: m.data?.file_id || m.data?.id || '',
        name: m.data?.name || 'file',
        size: m.data?.size || ''
      });
    } else if (m.type === 'voice') {
      // 语音暂不处理
    }
  }
  
  return { text: text.trim(), images, files };
}

// ============ NapCatQQ API 调用 ============
function napcatApi(action, params, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!napcatWs || napcatWs.readyState !== 1) {
      reject(new Error('NapCatQQ 未连接'));
      return;
    }
    
    const echo = nextEcho();
    const payload = { action, params, echo };
    
    const timer = setTimeout(() => {
      pendingRequests.delete(echo);
      reject(new Error(`API ${action} 超时`));
    }, timeoutMs);
    
    pendingRequests.set(echo, { resolve, reject, timer });
    napcatWs.send(JSON.stringify(payload));
  });
}

async function downloadImage(img) {
  try {
    // 确保目录存在
    const fs = require('fs');
    if (!fs.existsSync(IMG_DIR)) {
      fs.mkdirSync(IMG_DIR, { recursive: true });
    }
    
    let buffer = null;
    let contentType = 'image/jpeg';
    
    // 优先使用 url 直接下载
    if (img.url) {
      log('QQ', `   尝试下载图片 from URL...`);
      try {
        const response = await fetch(img.url);
        if (response.ok) {
          buffer = await response.arrayBuffer();
          contentType = response.headers.get('content-type') || 'image/jpeg';
        }
      } catch (e) {
        log('QQ', `   URL 下载失败: ${e.message}`);
      }
    }
    
    // 备用：用 file_id 或 file 调用 API
    if (!buffer) {
      const fileId = img.file_id || img.file;
      if (fileId) {
        log('QQ', `   尝试用 file_id: ${fileId} 获取图片`);
        try {
          const result = await napcatApi('get_image', { file_id: fileId });
          if (result.data?.base64) {
            buffer = Buffer.from(result.data.base64, 'base64');
          } else if (result.data?.url) {
            const resp = await fetch(result.data.url);
            if (resp.ok) {
              buffer = await resp.arrayBuffer();
              contentType = resp.headers.get('content-type') || 'image/jpeg';
            }
          }
        } catch (e) {
          log('QQ', `   API 获取失败: ${e.message}`);
        }
      }
    }
    
    if (!buffer) {
      log('QQ', `   ❌ 无法获取图片`);
      return null;
    }
    
    // 保存到本地文件
    const filename = `img_${Date.now()}_${img.name || 'image.jpg'}`;
    const filepath = IMG_DIR + filename;
    const buf = Buffer.from(buffer);
    fs.writeFileSync(filepath, buf);
    log('QQ', `   ✅ 图片保存成功: ${filename} (${buf.length} bytes)`);
    return { type: 'image', path: filepath, contentType, base64: buf.toString('base64') };
  } catch (e) {
    log('ERROR', `下载图片失败: ${e.message}`);
    return null;
  }
}

async function downloadFile(file) {
  try {
    const fs = require('fs');
    if (!fs.existsSync(FILE_DIR)) {
      fs.mkdirSync(FILE_DIR, { recursive: true });
    }
    
    let buffer = null;
    let filename = file.name || file.file_id || 'file';
    
    // 清理文件名
    filename = filename.replace(/[<>:"/\\|?*]/g, '_');
    
    // 优先用 URL 下载
    if (file.url) {
      try {
        const response = await fetch(file.url);
        if (response.ok) {
          buffer = await response.arrayBuffer();
        }
      } catch (e) {
        log('QQ', `   URL 下载失败: ${e.message}`);
      }
    }
    
    // 备用：用 API
    if (!buffer) {
      const fileId = file.file_id;
      if (fileId) {
        try {
          const result = await napcatApi('get_file', { file_id: fileId });
          if (result.data?.base64) {
            buffer = Buffer.from(result.data.base64, 'base64');
            if (result.data.file_name) filename = result.data.file_name;
          } else if (result.data?.url) {
            const resp = await fetch(result.data.url);
            if (resp.ok) {
              buffer = await resp.arrayBuffer();
            }
          }
        } catch (e) {
          log('QQ', `   API 获取失败: ${e.message}`);
        }
      }
    }
    
    if (!buffer) {
      log('QQ', `   ❌ 无法获取文件`);
      return null;
    }
    
    const buf = Buffer.from(buffer);
    const filepath = FILE_DIR + filename;
    fs.writeFileSync(filepath, buf);
    log('QQ', `   ✅ 文件保存成功: ${filename} (${buf.length} bytes)`);
    return { type: 'file', path: filepath, name: filename };
  } catch (e) {
    log('ERROR', `下载文件失败: ${e.message}`);
    return null;
  }
}

// ============ NapCatQQ 发送 ============
function sendPrivateMessage(userId, text, echo) {
  const payload = {
    action: 'send_private_msg',
    params: {
      user_id: parseInt(userId),
      message: text,
      auto_escape: false
    },
    echo: echo
  };
  
  if (napcatWs && napcatWs.readyState === 1) {
    napcatWs.send(JSON.stringify(payload));
  } else {
    log('WARN', 'NapCatQQ 未连接，无法发送');
  }
}

// ============ OpenClaw ============
async function sendToOpenClaw(userId, text, attachments = []) {
  try {
    log('OPENCLAW', `发送请求: ${text.substring(0, 30)}...`);
    
    // 构建消息内容
    let input = text;
    if (attachments.length > 0) {
      // 附加文件路径
      for (const att of attachments) {
        if (att.type === 'image' && att.path) {
          input += `\n\n[图片: ${att.path}]`;
        } else if (att.type === 'file' && att.path) {
          input += `\n\n[文件: ${att.path}]`;
        }
      }
    }
    
    const response = await fetch(`${OPENCLAW_API}/v1/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openclaw',
        input: input || '[图片]',
        user: `qq-${userId}`
      })
    });
    
    const data = await response.json();
    
    if (data.output && data.output.length > 0) {
      const output = data.output[0];
      let replyText = '';
      
      if (output.content) {
        for (const item of output.content) {
          if (item.type === 'output_text') {
            replyText += item.text;
          }
        }
      }
      
      if (replyText) {
        const echo = nextEcho();
        log('QQ', `发送回复给 ${userId}: ${replyText.substring(0, 50)}...`);
        sendPrivateMessage(userId, replyText, echo);
      } else {
        log('WARN', '无回复内容');
      }
    } else {
      log('ERROR', '响应格式异常: ' + JSON.stringify(data).substring(0, 200));
    }
  } catch (e) {
    log('ERROR', `请求失败: ${e.message}`);
  }
}

// ============ NapCatQQ 连接 ============
function connectNapCat() {
  const url = `ws://${NAPCAT_HOST}:${NAPCAT_PORT}`;
  log('NAPCAT', `连接 NapCatQQ: ${url}`);
  
  napcatWs = new WebSocket(url, {
    headers: { 'Authorization': `Bearer ${NAPCAT_TOKEN}` }
  });

  napcatWs.on('open', () => {
    connected = true;
    log('NAPCAT', '✅ 已连接 NapCatQQ');
  });

  napcatWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // 检查是否是 API 响应
      if (msg.echo && pendingRequests.has(msg.echo)) {
        const { resolve, reject, timer } = pendingRequests.get(msg.echo);
        clearTimeout(timer);
        pendingRequests.delete(msg.echo);
        resolve(msg);
        return;
      }
      
      // 处理收到的事件消息
      handleNapCatMessage(msg);
    } catch (e) {
      log('ERROR', `解析消息失败: ${e.message}`);
    }
  });

  napcatWs.on('close', (code, reason) => {
    connected = false;
    log('NAPCAT', `❌ 断开 (code=${code})`);
    setTimeout(connectNapCat, 3000);
  });

  napcatWs.on('error', (e) => {
    log('NAPCAT', `⚠️ WS 错误: ${e.message}`);
  });
}

async function handleNapCatMessage(msg) {
  // 只处理私聊消息
  if (msg.post_type !== 'message' || msg.message_type !== 'private') {
    return;
  }

  const userId = String(msg.user_id);
  const parts = extractMessageParts(msg.message);
  
  if (!parts.text && parts.images.length === 0 && parts.files.length === 0) {
    return;
  }

  log('QQ', `📩 收到 (${userId}): ${msg.message ? JSON.stringify(msg.message).substring(0, 200) : parts.text}`);
  if (parts.images.length > 0) log('QQ', `   图片: ${parts.images.length}张, file_id: ${parts.images[0].file_id}`);
  if (parts.files.length > 0) log('QQ', `   文件: ${parts.files.length}个`);

  // 下载图片/文件
  const attachments = [];
  
  for (const img of parts.images) {
    if (img.file_id) {
      const downloaded = await downloadImage(img);
      if (downloaded) {
        attachments.push(downloaded);
        log('QQ', `   ✅ 图片下载成功 (${downloaded.base64.length} chars)`);
      }
    }
  }
  
  for (const file of parts.files) {
    if (file.file_id) {
      const downloaded = await downloadFile(file);
      if (downloaded) {
        attachments.push(downloaded);
        log('QQ', `   ✅ 文件下载成功: ${file.name}`);
      }
    }
  }

  // 发送到 OpenClaw
  sendToOpenClaw(userId, parts.text, attachments);
}

// ============ 主程序 ============
log('BRIDGE', '🌟 NapCat-OpenClaw 桥接启动 (支持图片/文件)');
log('BRIDGE', `NapCatQQ: ws://${NAPCAT_HOST}:${NAPCAT_PORT}`);
log('BRIDGE', `OpenClaw:  ${OPENCLAW_API}`);

connectNapCat();
