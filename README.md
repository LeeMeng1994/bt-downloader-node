# BT Downloader (Node.js 版)

## 项目状态

### 已完成
- ✅ Node.js 后端服务 (server.js)
- ✅ Web 管理界面 (public/index.html)
- ✅ 支持 TCP/UDP tracker (公共 tracker 列表)
- ✅ 磁力链接和 .torrent 文件添加
- ✅ 下载管理 (开始/暂停/删除)
- ✅ WebSocket 实时更新
- ✅ 文件下载 API
- ✅ 系统托盘 (Python + pystray)
- ⚠️ 托盘退出功能 (有问题：浏览器窗口未关闭)

### 待修复
- 🔴 托盘退出时浏览器窗口未关闭
- 🔴 托盘图标显示有延迟

### 文件结构
```
bt-downloader-node/
├── server.js          # Node.js 后端服务
├── app.js             # 启动器 (Node.js + 托盘)
├── tray_app.py        # Python 托盘程序 (pystray)
├── package.json       # 项目配置
├── start.bat          # Windows 启动脚本
├── downloads/         # 下载目录
└── public/
    └── index.html     # Web 管理界面
```

### 启动方式
1. 命令行: `node app.js`
2. 或: `start.bat`

### 依赖
- Node.js >= 16
- Python 3.x (用于系统托盘)
- 包: torrent-stream, parse-torrent, express, ws, multer, cors, mime-types
- Python 包: pystray, Pillow

## 已知问题

### 托盘退出问题
- 点击托盘"退出"后，托盘图标消失但浏览器窗口未关闭
- Node.js 服务可能仍在运行
- 需要手动关闭浏览器窗口和 node.exe 进程

### 解决方案尝试
1. ✅ 使用 pystray 创建托盘图标
2. ✅ 调用 /api/shutdown 关闭 Node.js 服务
3. ❌ 使用 ctypes 关闭 Edge 窗口 (未成功)
4. ❌ 使用 taskkill 关闭 msedge.exe (会影响其他浏览器窗口)

### 下一步
- 考虑使用更可靠的窗口管理方案
- 或改用其他浏览器启动方式
