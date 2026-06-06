// PikPak 离线下载加速模块
// 免费额度：6GB 空间，支持磁力离线下载

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PIKPAK_API = 'https://api-drive.mypikpak.com';
const PIKPAK_USER = 'https://user.mypikpak.com';

class PikPakAccelerator {
    constructor() {
        this.token = null;
        this.refreshToken = null;
        this.deviceId = this.generateDeviceId();
        this.configPath = path.join(__dirname, 'pikpak-config.json');
        this.loadConfig();
    }

    generateDeviceId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.token = cfg.token;
                this.refreshToken = cfg.refreshToken;
            } catch (e) {}
        }
    }

    saveConfig() {
        fs.writeFileSync(this.configPath, JSON.stringify({
            token: this.token,
            refreshToken: this.refreshToken
        }, null, 2));
    }

    // 使用匿名方式（无需登录）获取下载链接
    // 通过 PikPak 的分享功能获取缓存
    async getCachedDownload(magnetLink) {
        try {
            // 提取 infohash
            const infoHash = this.extractInfoHash(magnetLink);
            if (!infoHash) return null;

            // 尝试从 PikPak 分享搜索
            const result = await this.searchPikPakShare(infoHash);
            if (result && result.webContentLink) {
                return {
                    type: 'cached',
                    url: result.webContentLink,
                    name: result.name,
                    size: result.size,
                    source: 'PikPak Cache'
                };
            }

            return null;
        } catch (err) {
            console.error('PikPak cache check failed:', err.message);
            return null;
        }
    }

    extractInfoHash(magnet) {
        const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
        return match ? match[1].toLowerCase() : null;
    }

    // 搜索 PikPak 分享（简化版，实际需调用搜索 API）
    async searchPikPakShare(infoHash) {
        // 这里可以实现具体的 PikPak API 调用
        // 由于 PikPak API 需要认证，这里提供框架
        return null;
    }

    // 离线下载（需要登录）
    async addOfflineDownload(magnetLink, path = '/') {
        if (!this.token) {
            throw new Error('PikPak not logged in');
        }

        try {
            const response = await axios.post(
                `${PIKPAK_API}/drive/v1/files`,
                {
                    kind: 'drive#file',
                    name: magnetLink,
                    upload_type: 'UPLOAD_TYPE_URL',
                    url: { url: magnetLink }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (err) {
            if (err.response?.status === 401) {
                await this.refreshAccessToken();
                return this.addOfflineDownload(magnetLink, path);
            }
            throw err;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token');
        }

        try {
            const response = await axios.post(`${PIKPAK_USER}/v1/auth/token`, {
                client_id: 'YNxT9w7GMdWvEOKa',
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            });

            this.token = response.data.access_token;
            this.refreshToken = response.data.refresh_token;
            this.saveConfig();
        } catch (err) {
            throw new Error('Failed to refresh token: ' + err.message);
        }
    }

    // 获取离线任务状态
    async getOfflineTaskStatus(taskId) {
        if (!this.token) return null;

        try {
            const response = await axios.get(
                `${PIKPAK_API}/drive/v1/tasks/${taskId}`,
                {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                }
            );
            return response.data;
        } catch (err) {
            return null;
        }
    }
}

// 备用方案：使用公共缓存服务
class PublicCacheAccelerator {
    constructor() {
        this.cacheServices = [
            { name: 'BitTorrent Cache', url: 'https://btcache.me' },
            { name: 'TorCache', url: 'https://torcache.net' }
        ];
    }

    async getCachedTorrent(infoHash) {
        for (const service of this.cacheServices) {
            try {
                const url = `${service.url}/torrent/${infoHash.toUpperCase()}.torrent`;
                const response = await axios.head(url, { timeout: 5000 });
                if (response.status === 200) {
                    return { url, name: service.name };
                }
            } catch (e) {
                // 服务不可用，尝试下一个
            }
        }
        return null;
    }
}

module.exports = {
    PikPakAccelerator,
    PublicCacheAccelerator
};
