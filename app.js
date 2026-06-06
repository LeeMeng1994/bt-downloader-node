const { spawn } = require('child_process');
const path = require('path');

// 启动 Node.js 服务
const serverPath = path.join(__dirname, 'server.js');
const server = spawn('node', [serverPath], {
    stdio: 'inherit',
    windowsHide: false
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(code);
});

server.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
});
