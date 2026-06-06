const http = require('http');

const magnet = 'magnet:?xt=urn:btih:9fc20b9e98ea98b4a35e6223041a5ef94ea27809&dn=ubuntu-24.04-desktop-amd64.iso';

const data = JSON.stringify({ magnet });

const req = http.request({
    hostname: 'localhost',
    port: 3456,
    path: '/api/add-magnet',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('Add response:', body);
        
        // 等待几秒后查询状态
        setTimeout(() => {
            http.get('http://localhost:3456/api/torrents', (res2) => {
                let body2 = '';
                res2.on('data', chunk => body2 += chunk);
                res2.on('end', () => {
                    console.log('List response:', body2);
                    process.exit(0);
                });
            });
        }, 15000);
    });
});

req.write(data);
req.end();
