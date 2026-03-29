# KCD2Gamble Three.js 前端

这是当前项目的 `Three.js + FastAPI` 子项目，提供一个可在局域网中双浏览器联机游玩的 3D 掷骰桌面。

当前版本已经包含：

- `Three.js` 3D 掷骰台与骰子表现
- `FastAPI` 后端桥接，复用根目录的 `dicegame/engine.py`
- 局域网双人同局游玩（玩家 A / 玩家 B）
- WebSocket 实时同步：回合、骰子状态、共享焦点、共享选中光标
- 键盘与鼠标混合操作
- 胜利结算视角、粒子反馈、主菜单与结算面板
- FastAPI 直接托管前端构建产物，便于内网部署

## 目录说明

- `src/`：Three.js 前端、HUD、交互逻辑
- `backend/`：FastAPI 局域网房间服务与 WebSocket 同步
- `dist/`：前端构建产物（执行 `npm.cmd run build` 后生成）

## 当前玩法说明

- 两个玩家访问同一个局域网地址，进入的是同一局游戏
- 玩家 A 负责发起新对局
- 玩家 B 加入后与玩家 A 共享同一张桌面状态
- 只有当前回合玩家可以操作
- 两边都能看到：
  - 掷骰结果
  - 当前回合状态
  - 对方的焦点光标与已选中骰子光标

当前默认使用单个局域网房间：`lan`

## 运行前准备

### 1. 安装 Python 依赖

```bash
cd threejs-frontend
python -m pip install -r backend/requirements.txt
```

### 2. 安装 WebSocket 支持

局域网双人同步依赖 WebSocket。若仅安装基础版 `uvicorn`，可能会看到：

- `Unsupported upgrade request`
- `No supported WebSocket library detected`

建议执行下面其中一种：

```bash
python -m pip install "uvicorn[standard]"
```

或最小安装：

```bash
python -m pip install websockets
```

### 3. 安装前端依赖

如果 PowerShell 阻止 `npm.ps1`，请直接使用 `npm.cmd`：

```bash
cd threejs-frontend
npm.cmd install --cache ".npm-cache"
```

## 局域网双人运行方式

### 1. 构建前端

```bash
cd threejs-frontend
npm.cmd run build
```

### 2. 启动后端服务

```bash
cd threejs-frontend
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

说明：

- `0.0.0.0` 表示允许局域网内其他设备访问
- FastAPI 会自动托管 `dist/` 中的前端页面与资源

### 3. 获取本机局域网 IP

在 Windows PowerShell 中执行：

```bash
ipconfig
```

找到当前网卡的 `IPv4`，例如：

- `192.168.1.20`

### 4. 两位玩家分别访问

在各自浏览器中打开：

```text
http://192.168.1.20:8000
```

将上面的 IP 替换成你的实际局域网地址。

## 进入游戏

1. 两位玩家都打开同一个局域网地址
2. 一位选择 `玩家 A`
3. 另一位选择 `玩家 B`
4. 玩家 A 设置目标分数并开始新对局
5. 双方进入同一局游戏，后续状态实时同步

### 座位规则

- 同一个座位同一时间只能被一个浏览器占用
- 玩家 A 可以开始新对局
- 玩家 B 只能加入当前房间并参与该局
- 刷新页面时会尝试恢复原座位
- 断开连接一段时间后，座位会自动释放

## 操作方式

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
- 双端会同步看到这些光标状态

## 本地开发模式

如果你只是想本机开发前端，可以前后端分开运行。

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

## 常见问题

### 1. 浏览器能打开，但另一位玩家无法连接

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

### 3. 页面内容更新了，但浏览器仍显示旧版本

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

- 当前默认只提供一个局域网房间：`lan`
- 后端状态保存在内存中，服务重启后当前对局会丢失
- 当前主要面向局域网双人游玩，不是正式公网部署方案
