const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');
const { URL } = require('url');

// Config file
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.error('Config load error:', e.message);
        }
    }
    return {};
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

const config = loadConfig();

// Get current download dir from config
function getDownloadDir() {
    return config.downloadDir || process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads');
}

// Ensure download dir exists
function ensureDownloadDir() {
    const dir = getDownloadDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

ensureDownloadDir();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve app.html as root (with cache-busting headers)
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// HTTP downloads
const httpDownloads = new Map();
let httpDownloadIdCounter = 1;

function broadcast(data) {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });
}

function getFilenameFromUrl(urlStr, headers) {
    const cd = headers['content-disposition'];
    if (cd) {
        const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match) {
            let fname = match[1].trim();
            if ((fname.startsWith('"') && fname.endsWith('"')) ||
                (fname.startsWith("'") && fname.endsWith("'"))) {
                fname = fname.slice(1, -1);
            }
            try {
                fname = decodeURIComponent(fname);
            } catch (e) {}
            if (fname) return fname;
        }
    }

    try {
        const urlObj = new URL(urlStr);
        const pathname = decodeURIComponent(urlObj.pathname);
        const base = path.basename(pathname);
        if (base && base !== '/' && base !== '') {
            return base;
        }
    } catch (e) {}

    return 'download_' + Date.now();
}

function broadcastHttpList() {
    const list = Array.from(httpDownloads.values()).map(d => ({
        id: d.id,
        url: d.url,
        filename: d.filename,
        status: d.status,
        progress: d.progress,
        size: d.size,
        downloaded: d.downloaded,
        speed: d.speed,
        error: d.error,
        filePath: d.filePath
    }));
    broadcast({ type: 'httpList', downloads: list });
}

function startHttpDownload(id, url, customFilename) {
    const download = httpDownloads.get(id);
    if (!download) return;

    download.status = 'downloading';
    download.error = null;

    const protocol = url.startsWith('https:') ? https : http;

    const request = protocol.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': new URL(url).origin + '/'
        }
    }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const redirectUrl = new URL(response.headers.location, url).href;
            console.log('Redirect to:', redirectUrl);
            startHttpDownload(id, redirectUrl, customFilename);
            return;
        }

        if (response.statusCode !== 200) {
            download.status = 'error';
            download.error = 'HTTP ' + response.statusCode;
            console.log('HTTP download error:', download.error, 'for URL:', url);
            broadcastHttpList();
            return;
        }

        const filename = customFilename || getFilenameFromUrl(url, response.headers);
        download.filename = filename;
        download.size = parseInt(response.headers['content-length']) || 0;

        const dir = getDownloadDir();
        const filePath = path.join(dir, filename);
        download.filePath = filePath;

        let finalPath = filePath;
        let counter = 1;
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        while (fs.existsSync(finalPath)) {
            finalPath = path.join(dir, base + '_' + counter + ext);
            counter++;
        }
        download.filePath = finalPath;

        const fileStream = fs.createWriteStream(finalPath);
        let lastTime = Date.now();
        let lastDownloaded = 0;

        response.on('data', (chunk) => {
            download.downloaded += chunk.length;

            const now = Date.now();
            const dt = now - lastTime;
            if (dt >= 1000) {
                download.speed = Math.round((download.downloaded - lastDownloaded) / (dt / 1000));
                lastDownloaded = download.downloaded;
                lastTime = now;

                if (download.size > 0) {
                    download.progress = download.downloaded / download.size;
                }
                broadcastHttpList();
            }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
            fileStream.close();
            download.status = 'done';
            download.progress = 1;
            download.speed = 0;
            console.log('HTTP download complete:', filename);
            broadcastHttpList();
            broadcast({ type: 'httpComplete', download: { id: download.id, filename: download.filename, filePath: download.filePath } });
        });

        fileStream.on('error', (err) => {
            download.status = 'error';
            download.error = err.message;
            fs.unlink(finalPath, () => {});
            broadcastHttpList();
        });
    });

    request.on('error', (err) => {
        download.status = 'error';
        download.error = err.message;
        broadcastHttpList();
    });

    request.setTimeout(30000, () => {
        request.destroy();
        download.status = 'error';
        download.error = 'Request timeout';
        broadcastHttpList();
    });
}

// ========== API Routes ==========

app.get('/api/download-dir', (req, res) => {
    res.json({ dir: getDownloadDir() });
});

app.post('/api/download-dir', async (req, res) => {
    const { dir } = req.body;
    if (!dir) {
        return res.status(400).json({ error: 'Missing dir parameter' });
    }

    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.accessSync(dir, fs.constants.W_OK);

        config.downloadDir = dir;
        saveConfig(config);

        res.json({ dir, message: 'Download dir updated' });
    } catch (err) {
        res.status(400).json({ error: 'Invalid path or no write permission: ' + err.message });
    }
});

app.get('/api/dir-list', (req, res) => {
    const dir = req.query.dir || '';

    try {
        let targetPath;
        let isRoot = false;

        if (!dir) {
            // Root - return drive list
            isRoot = true;
            const drives = [];
            for (let i = 65; i <= 90; i++) {
                const drive = String.fromCharCode(i) + ':\\';
                try {
                    fs.accessSync(drive, fs.constants.F_OK);
                    drives.push(drive);
                } catch (e) {
                    // Drive does not exist
                }
            }
            return res.json({
                isRoot: true,
                current: '',
                parent: null,
                dirs: drives
            });
        } else {
            targetPath = path.resolve(dir);
            if (!fs.existsSync(targetPath)) {
                return res.status(400).json({ error: 'Directory does not exist' });
            }
            if (!fs.statSync(targetPath).isDirectory()) {
                return res.status(400).json({ error: 'Not a directory' });
            }
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort((a, b) => a.localeCompare(b, 'zh-CN'));

        const parent = path.dirname(targetPath);
        const isAtRoot = parent === targetPath;

        res.json({
            isRoot: false,
            current: targetPath,
            parent: isAtRoot ? '' : parent,
            dirs
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        downloadDir: getDownloadDir()
    });
});

// Open download directory in file explorer
app.post('/api/open-download-dir', (req, res) => {
    const dir = getDownloadDir();
    try {
        const { exec } = require('child_process');
        if (process.platform === 'win32') {
            exec(`explorer "${dir}"`, (err) => {
                if (err) {
                    console.error('Open dir error:', err);
                    return res.status(500).json({ error: 'Failed to open directory' });
                }
                res.json({ success: true, dir });
            });
        } else if (process.platform === 'darwin') {
            exec(`open "${dir}"`, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to open directory' });
                }
                res.json({ success: true, dir });
            });
        } else {
            exec(`xdg-open "${dir}"`, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to open directory' });
                }
                res.json({ success: true, dir });
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// HTTP download APIs
app.post('/api/add-http', (req, res) => {
    const { url, filename } = req.body;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing URL' });
    }

    try {
        new URL(url);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    const id = httpDownloadIdCounter++;
    const download = {
        id,
        url,
        filename: filename || 'Unknown',
        status: 'pending',
        progress: 0,
        size: 0,
        downloaded: 0,
        speed: 0,
        error: null,
        filePath: null
    };
    httpDownloads.set(id, download);

    res.json({ id, message: 'Download started' });
    broadcastHttpList();

    setTimeout(() => {
        startHttpDownload(id, url, filename);
    }, 0);
});

app.get('/api/http-downloads', (req, res) => {
    const list = Array.from(httpDownloads.values()).map(d => ({
        id: d.id,
        url: d.url,
        filename: d.filename,
        status: d.status,
        progress: d.progress,
        size: d.size,
        downloaded: d.downloaded,
        speed: d.speed,
        error: d.error,
        filePath: d.filePath
    }));
    res.json(list);
});

app.delete('/api/http-downloads/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const download = httpDownloads.get(id);
    if (!download) {
        return res.status(404).json({ error: 'Download not found' });
    }

    httpDownloads.delete(id);
    broadcastHttpList();
    res.json({ message: 'Download removed' });
});

app.get('/api/http-downloads/:id/download', (req, res) => {
    const id = parseInt(req.params.id);
    const download = httpDownloads.get(id);
    if (!download || !download.filePath || !fs.existsSync(download.filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const mimeType = mime.lookup(download.filePath) || 'application/octet-stream';
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(download.filename) + '"');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fs.statSync(download.filePath).size);

    fs.createReadStream(download.filePath).pipe(res);
});

// ========== WebSocket ==========

wss.on('connection', ws => {
    console.log('WebSocket client connected');

    // Send current state
    const httpList = Array.from(httpDownloads.values()).map(d => ({
        id: d.id,
        url: d.url,
        filename: d.filename,
        status: d.status,
        progress: d.progress,
        size: d.size,
        downloaded: d.downloaded,
        speed: d.speed,
        error: d.error,
        filePath: d.filePath
    }));
    ws.send(JSON.stringify({ type: 'httpList', downloads: httpList }));

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

// ========== Startup ==========

const DEFAULT_PORT = 3456;

function startServer(port) {
    server.listen(port, () => {
        const actualPort = server.address().port;
        const url = 'http://localhost:' + actualPort;
        console.log('HTTP Downloader server running on ' + url);
        console.log('Download directory: ' + getDownloadDir());
        
        // 自动打开浏览器
        const platform = process.platform;
        let cmd;
        if (platform === 'win32') {
            cmd = 'start "" "' + url + '"';
        } else if (platform === 'darwin') {
            cmd = 'open "' + url + '"';
        } else {
            cmd = 'xdg-open "' + url + '"';
        }
        require('child_process').exec(cmd, (err) => {
            if (err) console.log('Failed to open browser:', err.message);
            else console.log('Browser opened: ' + url);
        });
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('Port ' + port + ' is in use, trying port ' + (port + 1) + '...');
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
            process.exit(1);
        }
    });
}

startServer(process.env.PORT || DEFAULT_PORT);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
});
