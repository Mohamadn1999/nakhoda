const express = require('express');
const cors = require('cors');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
const UUID = process.env.UUID || uuidv4();

const app = express();
app.use(cors());
app.use(express.json());

// دانلود Xray
async function setupXray() {
    const XRAY_PATH = '/tmp/xray';
    
    if (fs.existsSync(XRAY_PATH)) {
        console.log('✅ Xray already downloaded');
        return XRAY_PATH;
    }
    
    console.log('📥 Downloading Xray...');
    try {
        const { execSync } = require('child_process');
        execSync('wget -q https://github.com/XTLS/Xray-core/releases/download/v1.8.10/Xray-linux-64.zip -O /tmp/xray.zip');
        execSync('unzip -qo /tmp/xray.zip -d /tmp/');
        execSync('chmod +x /tmp/xray');
        console.log('✅ Xray downloaded');
        return XRAY_PATH;
    } catch (error) {
        console.error('❌ Failed to download Xray:', error.message);
        return null;
    }
}

// راه‌اندازی Xray با WebSocket که از طریق Express تونل میشه
async function startXray() {
    const xrayPath = await setupXray();
    if (!xrayPath) return null;
    
    // کانفیگ Xray - فقط اینباند داخلی
    const config = {
        log: { loglevel: "warning" },
        inbounds: [{
            tag: "ws-in",
            port: 10000,
            listen: "127.0.0.1",
            protocol: "vmess",
            settings: {
                clients: [{ id: UUID, alterId: 0 }]
            },
            streamSettings: {
                network: "ws",
                wsSettings: { path: "/proxy-ws" }
            }
        }, {
            tag: "vless-in",
            port: 10001,
            listen: "127.0.0.1",
            protocol: "vless",
            settings: {
                clients: [{ id: UUID, encryption: "none" }],
                decryption: "none"
            },
            streamSettings: {
                network: "ws",
                wsSettings: { path: "/vless-ws" }
            }
        }, {
            tag: "trojan-in",
            port: 10002,
            listen: "127.0.0.1",
            protocol: "trojan",
            settings: {
                clients: [{
                    password: UUID.substring(0, 16),
                    email: "user@railway.app"
                }]
            },
            streamSettings: {
                network: "ws",
                wsSettings: { path: "/trojan-ws" }
            }
        }],
        outbounds: [{
            protocol: "freedom",
            settings: {}
        }]
    };
    
    const configPath = '/tmp/config.json';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    const xray = spawn(xrayPath, ['run', '-config', configPath], {
        stdio: 'pipe'
    });
    
    xray.stdout.on('data', (data) => {
        if (data.toString().includes('started')) {
            console.log('✅ Xray is running');
        }
    });
    
    xray.stderr.on('data', (data) => {
        console.log('Xray:', data.toString().trim());
    });
    
    return xray;
}

// WebSocket Proxy Handler
function createProxyHandler(targetPort) {
    return function(req, res) {
        // Check if it's a WebSocket upgrade request
        if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
            const proxyReq = http.request({
                hostname: '127.0.0.1',
                port: targetPort,
                path: req.url,
                method: req.method,
                headers: req.headers
            });
            
            proxyReq.on('upgrade', (proxyRes, socket, head) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                
                // Pipe the socket
                socket.pipe(res.socket);
                res.socket.pipe(socket);
                
                res.socket.on('close', () => {
                    socket.destroy();
                });
                
                socket.on('close', () => {
                    res.socket.destroy();
                });
            });
            
            proxyReq.on('error', (err) => {
                console.error('Proxy error:', err.message);
                res.status(502).send('Proxy Error');
            });
            
            proxyReq.end();
        } else {
            res.status(400).send('WebSocket connections only');
        }
    };
}

// API: اطلاعات کانفیگ‌ها
app.get('/api/info', (req, res) => {
    const trojanPassword = UUID.substring(0, 16);
    
    // VMess Config
    const vmessConfig = JSON.stringify({
        v: "2",
        ps: "Railway-Xray",
        add: RAILWAY_DOMAIN,
        port: "443",
        id: UUID,
        aid: "0",
        scy: "auto",
        net: "ws",
        type: "none",
        host: RAILWAY_DOMAIN,
        path: "/proxy-ws",
        tls: "tls",
        sni: RAILWAY_DOMAIN
    });
    
    res.json({
        success: true,
        domain: RAILWAY_DOMAIN,
        uuid: UUID,
        configs: {
            vmess: {
                type: "vmess",
                link: "vmess://" + Buffer.from(vmessConfig).toString('base64'),
                path: "/proxy-ws",
                port: 443,
                tls: true
            },
            vless: {
                type: "vless",
                link: `vless://${UUID}@${RAILWAY_DOMAIN}:443?encryption=none&security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Fvless-ws#Railway-Xray`,
                path: "/vless-ws",
                port: 443,
                tls: true
            },
            trojan: {
                type: "trojan",
                link: `trojan://${trojanPassword}@${RAILWAY_DOMAIN}:443?security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Ftrojan-ws#Railway-Xray`,
                path: "/trojan-ws",
                port: 443,
                tls: true
            }
        }
    });
});

// WebSocket Routes - این مهمه!
app.all('/proxy-ws', createProxyHandler(10000));
app.all('/vless-ws', createProxyHandler(10001));
app.all('/trojan-ws', createProxyHandler(10002));

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        xray: fs.existsSync('/tmp/xray') ? 'installed' : 'not installed',
        domain: RAILWAY_DOMAIN,
        timestamp: new Date().toISOString()
    });
});

// صفحه اصلی
app.get('/', (req, res) => {
    const trojanPass = UUID.substring(0, 16);
    
    // VMess link
    const vmessConfig = JSON.stringify({
        v: "2", ps: "Railway-Xray", add: RAILWAY_DOMAIN, port: "443",
        id: UUID, aid: "0", scy: "auto", net: "ws", type: "none",
        host: RAILWAY_DOMAIN, path: "/proxy-ws", tls: "tls", sni: RAILWAY_DOMAIN
    });
    const vmessLink = "vmess://" + Buffer.from(vmessConfig).toString('base64');
    
    const vlessLink = `vless://${UUID}@${RAILWAY_DOMAIN}:443?encryption=none&security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Fvless-ws#Railway-Xray`;
    const trojanLink = `trojan://${trojanPass}@${RAILWAY_DOMAIN}:443?security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Ftrojan-ws#Railway-Xray`;
    
    res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🚀 Railway Xray - کار میکنه!</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, sans-serif;
            background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }
        .container { max-width: 900px; margin: 0 auto; }
        h1 {
            text-align: center;
            font-size: 2.5rem;
            margin: 30px 0;
            background: linear-gradient(45deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .status-bar {
            background: rgba(72, 199, 142, 0.1);
            border: 1px solid rgba(72, 199, 142, 0.3);
            border-radius: 12px;
            padding: 15px 25px;
            margin: 20px 0;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .dot {
            width: 12px; height: 12px;
            background: #48c78e;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .config-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 15px;
            padding: 25px;
            margin: 20px 0;
            backdrop-filter: blur(10px);
        }
        .config-card h3 {
            font-size: 1.5rem;
            margin-bottom: 15px;
            color: #667eea;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 10px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            margin: 8px 0;
            font-size: 0.9rem;
        }
        .info-label { color: #a0aec0; }
        .info-value { font-family: monospace; color: #e2e8f0; direction: ltr; }
        .link-box {
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 12px;
            margin: 15px 0;
            font-family: monospace;
            font-size: 0.75rem;
            word-break: break-all;
            color: #a0aec0;
            direction: ltr;
            text-align: left;
            max-height: 60px;
            overflow-y: auto;
        }
        .btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(102,126,234,0.4); }
        .btn:active { transform: translateY(0); }
        .toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #48c78e;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 1000;
            animation: slideDown 0.3s ease;
        }
        @keyframes slideDown {
            from { transform: translate(-50%, -100%); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Railway Xray Panel</h1>
        
        <div class="status-bar">
            <div class="dot"></div>
            <strong>آنلاین و آماده استفاده</strong>
            <span style="margin-right: auto; font-size: 0.9rem; opacity: 0.8;">
                ${RAILWAY_DOMAIN}
            </span>
        </div>
        
        <div class="config-card">
            <h3>📡 Vmess + WS + TLS</h3>
            <div class="info-row">
                <span class="info-label">پورت:</span>
                <span class="info-value">443 (HTTPS)</span>
            </div>
            <div class="info-row">
                <span class="info-label">TLS:</span>
                <span class="info-value" style="color: #48c78e;">✅ فعال</span>
            </div>
            <div class="link-box">${vmessLink}</div>
            <button class="btn" onclick="copyToClipboard('${vmessLink.replace(/'/g, "\\'")}', 'Vmess')">
                📋 کپی کانفیگ Vmess
            </button>
        </div>
        
        <div class="config-card">
            <h3>⚡ Vless + WS + TLS</h3>
            <div class="info-row">
                <span class="info-label">پورت:</span>
                <span class="info-value">443 (HTTPS)</span>
            </div>
            <div class="info-row">
                <span class="info-label">TLS:</span>
                <span class="info-value" style="color: #48c78e;">✅ فعال</span>
            </div>
            <div class="link-box">${vlessLink}</div>
            <button class="btn" onclick="copyToClipboard('${vlessLink.replace(/'/g, "\\'")}', 'Vless')">
                📋 کپی کانفیگ Vless
            </button>
        </div>
        
        <div class="config-card">
            <h3>🔐 Trojan + WS + TLS</h3>
            <div class="info-row">
                <span class="info-label">پورت:</span>
                <span class="info-value">443 (HTTPS)</span>
            </div>
            <div class="info-row">
                <span class="info-label">TLS:</span>
                <span class="info-value" style="color: #48c78e;">✅ فعال</span>
            </div>
            <div class="link-box">${trojanLink}</div>
            <button class="btn" onclick="copyToClipboard('${trojanLink.replace(/'/g, "\\'")}', 'Trojan')">
                📋 کپی کانفیگ Trojan
            </button>
        </div>
    </div>
    
    <script>
        function copyToClipboard(text, type) {
            navigator.clipboard.writeText(text).then(() => {
                const toast = document.createElement('div');
                toast.className = 'toast';
                toast.textContent = '✅ کانفیگ ' + type + ' کپی شد!';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 3000);
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                alert('✅ کانفیگ کپی شد!');
            });
        }
    </script>
</body>
</html>`);
});

// Start everything
async function main() {
    console.log('🚀 Starting Railway Xray Panel...\n');
    
    const xrayProcess = await startXray();
    
    if (xrayProcess) {
        console.log('✅ Xray proxy started on internal ports');
        console.log('📡 WebSocket paths:');
        console.log('   - /proxy-ws (VMess)');
        console.log('   - /vless-ws (VLESS)');
        console.log('   - /trojan-ws (Trojan)\n');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Panel: https://${RAILWAY_DOMAIN}`);
        console.log(`🔑 UUID: ${UUID}`);
        console.log('✅ Ready to use!\n');
    });
}

main().catch(console.error);
