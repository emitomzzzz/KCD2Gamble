# KCD2Gamble Three.js 前端

这是当前项目的 `Three.js + FastAPI` 子项目，提供一个 3D 掷骰桌面，并支持两种对战模式：

- `局域网双人对战`：两位玩家在各自浏览器中进入同一局游戏
- `同屏轮流对战`：在同一个页面里由两位玩家轮流操作

## 当前能力

- `Three.js` 3D 掷骰台、骰子动画与 HUD
- `FastAPI` 后端桥接，复用根目录的 `dicegame/engine.py`
- LAN 房间 + A/B 座位 + WebSocket 实时同步
- Hotseat 同屏本地会话
- 鼠标与键盘混合操作
- 胜利结算镜头、粒子反馈、主菜单与结算面板
- FastAPI 直接托管前端构建产物，便于内网部署

## 目录说明

- `src/`：Three.js 前端、HUD、交互逻辑
- `backend/`：FastAPI 联机 / 同屏后端逻辑
- `dist/`：前端构建产物（执行 `npm.cmd run build` 后生成）

## 安装依赖

### Python

```bash
cd threejs-frontend
python -m pip install -r backend/requirements.txt
```

### WebSocket 支持

LAN 双人模式依赖 WebSocket。若启动时看到：

- `Unsupported upgrade request`
- `No supported WebSocket library detected`

请执行：

```bash
python -m pip install "uvicorn[standard]"
```

或最小安装：

```bash
python -m pip install websockets
```

### 前端

如果 PowerShell 阻止 `npm.ps1`，请使用 `npm.cmd`：

```bash
cd threejs-frontend
npm.cmd install --cache ".npm-cache"
```

## 本地开发

### 后端

```bash
cd threejs-frontend
python -m uvicorn backend.app:app --reload --port 8000
```

### 前端

```bash
cd threejs-frontend
npm.cmd run dev
```

### 开发端口

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

Vite 开发服务器会把 `/api` 代理到 FastAPI 后端。

## 构建与运行

```bash
cd threejs-frontend
npm.cmd run build
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

启动后：

- 本机访问：`http://127.0.0.1:8000`
- 局域网访问：`http://你的局域网IP:8000`

## 两种模式怎么用

### 1. 局域网双人对战

适合两位玩家分别在自己的浏览器中游玩。

步骤：

1. 两位玩家都访问同一个地址
2. 一位选择 `玩家 A`
3. 另一位选择 `玩家 B`
4. 玩家 A 设置目标分数并开始新对局
5. 之后双方实时看到同一张桌面状态

特点：

- 只有当前回合玩家可以操作
- 双方都能看到对方的焦点光标与选中光标
- 默认使用单个局域网房间：`lan`

### 2. 同屏轮流对战

适合同一台电脑、同一个页面里两位玩家轮流操作。

步骤：

1. 在主菜单选择 `同屏轮流对战`
2. 设置目标分数
3. 点击 `开始同屏对局`
4. 玩家 A / B 在同一个页面里轮流掷骰与计分

特点：

- 不需要 A/B 入座
- 不需要第二个浏览器
- 仍然按玩家 A / 玩家 B 的回合与得分规则进行

## 键盘与鼠标操作

### 鼠标

- 点击骰子：选中 / 取消选中骰子
- 点击按钮：执行掷骰、保存分数等操作

### 键盘

- `W / A / S / D`：在桌面骰子之间移动焦点
- `E`：选中当前焦点骰子
- `F`：掷骰 / 继续掷骰
- `Q`：计分并结束回合

### 光标反馈

- 黄色完整圆环：当前焦点骰子
- 红色下半圆环：已选中骰子
- 在 LAN 模式下，双方都会同步看到这些光标状态

## 常见问题

### 1. 另一位玩家无法连接

请检查：

- 两台设备是否在同一局域网
- 服务是否使用了 `--host 0.0.0.0`
- Windows 防火墙是否放行了 `8000` 端口

### 2. 启动时提示 WebSocket 不支持

请安装：

```bash
python -m pip install "uvicorn[standard]"
```

或：

```bash
python -m pip install websockets
```

### 3. 页面还是旧版本

请重新构建并强制刷新：

```bash
npm.cmd run build
```

然后在浏览器中按：

- `Ctrl + F5`

### 4. 中文显示异常

请确保前端源码文件使用 `UTF-8` 编码，并在修改后重新执行：

```bash
npm.cmd run build
```

## 当前限制

- LAN 模式当前默认只有一个局域网房间：`lan`
- 后端状态保存在内存中，服务重启后当前对局会丢失
- 当前主要面向局域网 / 本地游玩，不是正式公网部署方案
