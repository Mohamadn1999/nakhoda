const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const XRAY_PATH = path.join(__dirname, 'xray', 'xray');
const CONFIG_PATH = path.join(__dirname, 'xray', 'config.json');
const PORT = process.env.PORT || 3000;

// دامنه Railway
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
const RAILWAY_URL = `https://${RAILWAY_DOMAIN}`;

// تولید کانفیگ Xray
function generateXrayConfig() {
    const uuid = process.env.UUID || execSync('uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid').toString().trim();
    
    const xrayConfig = {
        "log": {
            "loglevel": "warning"
        },
        "inbounds": [
            {
                "port": 8080,
                "protocol": "vmess",
                "settings": {
                    "clients": [
                        {
                            "id": uuid,
                            "alterId": 0,
                            "security": "auto"
                        }
                    ]
                },
                "streamSettings": {
                    "network": "ws",
                    "wsSettings": {
                        "path": "/ws"
                    }
                }
            },
            {
                "port": 8081,
                "protocol": "vless",
                "settings": {
                    "clients": [
                        {
                            "id": uuid,
                            "encryption": "none"
                        }
                    ],
                    "decryption": "none"
                },
                "streamSettings": {
                    "network": "ws",
                    "wsSettings": {
                        "path": "/vless"
                    },
                    "security": "none"
                }
            },
            {
                "port": 8082,
                "protocol": "trojan",
                "settings": {
                    "clients": [
                        {
                            "password": uuid.substring(0, 16),
                            "email": "user@railway.app"
                        }
                    ]
                },
                "streamSettings": {
                    "network": "ws",
                    "wsSettings": {
                        "path": "/trojan"
                    },
                    "security": "none"
                }
            }
        ],
        "outbounds": [
            {
                "protocol": "freedom",
                "settings": {}
            }
        ]
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(xrayConfig, null, 2));
    return { uuid, config: xrayConfig };
}

// نصب Xray
async function installXray() {
    if (fs.existsSync(XRAY_PATH)) {
        console.log('✅ Xray already installed');
        return;
    }

    console.log('📦 Installing Xray...');
    const os = process.platform;
    const arch = process.arch;
    
    let downloadUrl = '';
    
    if (os === 'linux' && arch === 'x64') {
        downloadUrl = 'https://github.com/XTLS/Xray-core/releases/download/v1.8.10/Xray-linux-64.zip';
    } else if (os === 'linux' && arch === 'arm64') {
        downloadUrl = 'https://github.com/XTLS/Xray-core/releases/download/v1.8.10/Xray-linux-arm64-v8a.zip';
    } else {
        // Fallback - استفاده از wget
        console.log('⚠️ Unknown platform, trying generic install...');
    }

    try {
        fs.ensureDirSync(path.join(__dirname, 'xray'));
        
        if (downloadUrl) {
            execSync(`wget -q "${downloadUrl}" -O xray.zip && unzip -qo xray.zip -d xray/ && rm xray.zip`, {
                cwd: __dirname,
                stdio: 'inherit'
            });
        }
        
        // Make executable
        if (fs.existsSync(XRAY_PATH)) {
            fs.chmodSync(XRAY_PATH, '755');
            console.log('✅ Xray installed successfully');
        }
    } catch (error) {
        console.error('❌ Xray installation failed:', error.message);
    }
}

// راه‌اندازی Express Panel
function startPanel(uuid, xrayConfig) {
    const express = require('express');
    const cors = require('cors');
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static('public'));

    // Route for WebSocket proxy
    app.use('/ws', (req, res) => {
        // Xray handles WebSocket connections
        res.status(101).end();
    });

    // API Routes
    app.get('/api/info', (req, res) => {
        res.json({
            success: true,
            server: RAILWAY_URL,
            vmess: {
                port: 8080,
                uuid: uuid,
                ws_path: '/ws',
                config: `vmess://${Buffer.from(JSON.stringify({
                    v: "2",
                    ps: "Railway-Xray",
                    add: RAILWAY_DOMAIN,
                    port: "443",
                    id: uuid,
                    aid: "0",
                    net: "ws",
                    type: "none",
                    host: RAILWAY_DOMAIN,
                    path: "/ws",
                    tls: "tls"
                })).toString('base64')}`
            },
            vless: {
                port: 8081,
                uuid: uuid,
                ws_path: '/vless',
                config: `vless://${uuid}@${RAILWAY_DOMAIN}:443?encryption=none&security=tls&type=ws&host=${RAILWAY_DOMAIN}&path=/vless#Railway-VLESS`
            },
            trojan: {
                port: 8082,
                password: uuid.substring(0, 16),
                ws_path: '/trojan',
                config: `trojan://${uuid.substring(0, 16)}@${RAILWAY_DOMAIN}:443?security=tls&type=ws&host=${RAILWAY_DOMAIN}&path=/trojan#Railway-Trojan`
            }
        });
    });

    app.get('/api/test', (req, res) => {
        res.json({
            success: true,
            message: '✅ Xray Panel is working!',
            timestamp: new Date().toISOString(),
            domain: RAILWAY_DOMAIN
        });
    });

    // Serve Dashboard
    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="fa" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Railway Xray Panel | پنل رایگان</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 2rem;
                        direction: rtl;
                    }
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .header {
                        text-align: center;
                        color: white;
                        margin-bottom: 2rem;
                    }
                    .header h1 {
                        font-size: 2.5rem;
                        margin-bottom: 0.5rem;
                    }
                    .status-card {
                        background: rgba(255,255,255,0.95);
                        border-radius: 1rem;
                        padding: 2rem;
                        margin-bottom: 1.5rem;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                    }
                    .status-badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        background: #48c78e;
                        color: white;
                        padding: 0.5rem 1rem;
                        border-radius: 2rem;
                        font-weight: bold;
                    }
                    .dot {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: white;
                        animation: pulse 2s infinite;
                    }
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.5; }
                    }
                    .config-cards {
                        display: grid;
                        gap: 1rem;
                    }
                    .config-card {
                        background: rgba(255,255,255,0.95);
                        border-radius: 1rem;
                        padding: 1.5rem;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                    }
                    .config-card h3 {
                        color: #667eea;
                        margin-bottom: 1rem;
                        font-size: 1.5rem;
                    }
                    .config-link {
                        background: #f7fafc;
                        padding: 0.75rem;
                        border-radius: 0.5rem;
                        font-family: monospace;
                        font-size: 0.75rem;
                        word-break: break-all;
                        margin: 0.5rem 0;
                        color: #2d3748;
                        direction: ltr;
                        text-align: left;
                    }
                    .copy-btn {
                        background: #667eea;
                        color: white;
                        border: none;
                        padding: 0.5rem 1rem;
                        border-radius: 0.5rem;
                        cursor: pointer;
                        font-size: 0.875rem;
                        transition: all 0.3s;
                    }
                    .copy-btn:hover {
                        background: #5a67d8;
                        transform: translateY(-2px);
                    }
                    .info-row {
                        display: flex;
                        justify-content: space-between;
                        margin: 0.5rem 0;
                        padding: 0.5rem;
                        background: #f7fafc;
                        border-radius: 0.5rem;
                    }
                    .info-label {
                        color: #4a5568;
                        font-weight: bold;
                    }
                    .info-value {
                        color: #2d3748;
                        font-family: monospace;
                        direction: ltr;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🚀 Railway Xray Panel</h1>
                        <p>پنل مدیریت کانفیگ رایگان</p>
                    </div>
                    
                    <div class="status-card">
                        <h2>وضعیت سرور</h2>
                        <div style="margin-top: 1rem;">
                            <div class="status-badge">
                                <div class="dot"></div>
                                آنلاین
                            </div>
                        </div>
                        <div class="info-row" style="margin-top: 1rem;">
                            <span class="info-label">دامنه:</span>
                            <span class="info-value" id="domain">${RAILWAY_DOMAIN}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">UUID:</span>
                            <span class="info-value" id="uuid">${uuid}</span>
                        </div>
                    </div>

                    <div class="config-cards" id="configs">
                        <div style="text-align: center; color: white; padding: 2rem;">
                            <div class="loading" style="border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                            <p style="margin-top: 1rem;">در حال بارگذاری کانفیگ‌ها...</p>
                        </div>
                    </div>
                </div>

                <script>
                    async function loadConfigs() {
                        try {
                            const response = await fetch('/api/info');
                            const data = await response.json();
                            
                            const configsHtml = \`
                                <div class="config-card">
                                    <h3>📡 Vmess Configuration</h3>
                                    <div class="info-row">
                                        <span class="info-label">پورت:</span>
                                        <span class="info-value">\${data.vmess.port}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">WebSocket Path:</span>
                                        <span class="info-value">\${data.vmess.ws_path}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">TLS:</span>
                                        <span class="info-value">✅ فعال (443)</span>
                                    </div>
                                    <div class="config-link" id="vmess-link">\${data.vmess.config}</div>
                                    <button class="copy-btn" onclick="copyConfig('vmess-link', 'Vmess')">📋 کپی کانفیگ Vmess</button>
                                </div>

                                <div class="config-card">
                                    <h3>⚡ Vless Configuration</h3>
                                    <div class="info-row">
                                        <span class="info-label">پورت:</span>
                                        <span class="info-value">\${data.vless.port}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">WebSocket Path:</span>
                                        <span class="info-value">\${data.vless.ws_path}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">TLS:</span>
                                        <span class="info-value">✅ فعال (443)</span>
                                    </div>
                                    <div class="config-link" id="vless-link">\${data.vless.config}</div>
                                    <button class="copy-btn" onclick="copyConfig('vless-link', 'Vless')">📋 کپی کانفیگ Vless</button>
                                </div>

                                <div class="config-card">
                                    <h3>🔐 Trojan Configuration</h3>
                                    <div class="info-row">
                                        <span class="info-label">پورت:</span>
                                        <span class="info-value">\${data.trojan.port}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">WebSocket Path:</span>
                                        <span class="info-value">\${data.trojan.ws_path}</span>
                                    </div>
                                    <div class="info-row">
                                        <span class="info-label">TLS:</span>
                                        <span class="info-value">✅ فعال (443)</span>
                                    </div>
                                    <div class="config-link" id="trojan-link">\${data.trojan.config}</div>
                                    <button class="copy-btn" onclick="copyConfig('trojan-link', 'Trojan')">📋 کپی کانفیگ Trojan</button>
                                </div>
                            \`;
                            
                            document.getElementById('configs').innerHTML = configsHtml;
                        } catch (error) {
                            document.getElementById('configs').innerHTML = \`
                                <div style="text-align: center; color: white; padding: 2rem;">
                                    <p>❌ خطا در بارگذاری. لطفاً صفحه را refresh کنید.</p>
                                </div>
                            \`;
                        }
                    }

                    function copyConfig(elementId, type) {
                        const text = document.getElementById(elementId).textContent;
                        navigator.clipboard.writeText(text).then(() => {
                            alert('✅ کانفیگ ' + type + ' کپی شد!');
                        }).catch(() => {
                            // Fallback
                            const textarea = document.createElement('textarea');
                            textarea.value = text;
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textarea);
                            alert('✅ کانفیگ ' + type + ' کپی شد!');
                        });
                    }

                    // Load configs on page load
                    loadConfigs();
                </script>
            </body>
            </html>
        `);
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Panel running on port ${PORT}`);
        console.log(`📡 Domain: ${RAILWAY_URL}`);
        console.log(`🔑 UUID: ${uuid}`);
    });
}

// Main execution
async function main() {
    console.log('🚀 Starting Railway Xray Panel...');
    
    // Install Xray if needed
    await installXray();
    
    // Generate config
    const { uuid, config } = generateXrayConfig();
    console.log('✅ Xray config generated');
    
    // Start Xray in background
    if (fs.existsSync(XRAY_PATH)) {
        const xrayProcess = spawn(XRAY_PATH, ['-config', CONFIG_PATH], {
            stdio: 'inherit'
        });
        
        xrayProcess.on('error', (error) => {
            console.error('❌ Xray failed:', error);
        });
        
        console.log('✅ Xray proxy started');
    } else {
        console.log('⚠️ Xray not found, running panel only');
    }
    
    // Start Express panel
    startPanel(uuid, config);
}

main().catch(console.error);
