const express = require('express');
const cors = require('cors');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
const RAILWAY_URL = `https://${RAILWAY_DOMAIN}`;
const UUID = process.env.UUID || uuidv4();

// مسیرهای Xray
const XRAY_DIR = path.join(__dirname, 'xray');
const XRAY_PATH = path.join(XRAY_DIR, 'xray');
const CONFIG_PATH = path.join(XRAY_DIR, 'config.json');

// تنظیمات پیش‌فرض Xray
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
                        "id": UUID,
                        "alterId": 0,
                        "security": "auto"
                    }
                ]
            },
            "streamSettings": {
                "network": "ws",
                "wsSettings": {
                    "path": "/vmess-ws"
                }
            }
        },
        {
            "port": 8081,
            "protocol": "vless",
            "settings": {
                "clients": [
                    {
                        "id": UUID,
                        "encryption": "none"
                    }
                ],
                "decryption": "none"
            },
            "streamSettings": {
                "network": "ws",
                "wsSettings": {
                    "path": "/vless-ws"
                }
            }
        },
        {
            "port": 8082,
            "protocol": "trojan",
            "settings": {
                "clients": [
                    {
                        "password": UUID.substring(0, 16),
                        "email": "user@railway.app"
                    }
                ]
            },
            "streamSettings": {
                "network": "ws",
                "wsSettings": {
                    "path": "/trojan-ws"
                }
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

// دانلود و نصب Xray
async function downloadXray() {
    // اگر از قبل نصب شده، رد کن
    if (fs.existsSync(XRAY_PATH)) {
        console.log('✅ Xray already installed');
        return true;
    }

    console.log('📦 Downloading Xray...');
    
    try {
        // ساخت پوشه xray
        fs.ensureDirSync(XRAY_DIR);
        
        // تشخیص سیستم عامل
        const isARM = process.arch === 'arm64';
        const downloadUrl = isARM 
            ? 'https://github.com/XTLS/Xray-core/releases/download/v1.8.10/Xray-linux-arm64-v8a.zip'
            : 'https://github.com/XTLS/Xray-core/releases/download/v1.8.10/Xray-linux-64.zip';
        
        console.log(`⬇️ Downloading from: ${downloadUrl}`);
        
        // دانلود با wget (روی Railway موجوده)
        execSync(`wget -q "${downloadUrl}" -O /tmp/xray.zip`, {
            stdio: 'inherit'
        });
        
        // Extract
        execSync(`unzip -qo /tmp/xray.zip -d ${XRAY_DIR}/`, {
            stdio: 'inherit'
        });
        
        // پاک کردن فایل zip
        fs.removeSync('/tmp/xray.zip');
        
        // تنظیم دسترسی اجرایی
        if (fs.existsSync(XRAY_PATH)) {
            fs.chmodSync(XRAY_PATH, '755');
            console.log('✅ Xray installed successfully');
            return true;
        } else {
            console.log('❌ Xray binary not found after extraction');
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to download Xray:', error.message);
        console.log('📝 Will run panel only (without proxy)');
        return false;
    }
}

// راه‌اندازی Xray
function startXray() {
    if (!fs.existsSync(XRAY_PATH)) {
        console.log('⚠️ Xray not found, skipping proxy');
        return null;
    }

    // نوشتن کانفیگ
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(xrayConfig, null, 2));
    console.log('✅ Xray config written');
    
    // اجرای Xray
    const xrayProcess = spawn(XRAY_PATH, ['run', '-config', CONFIG_PATH], {
        stdio: 'pipe',
        env: process.env
    });
    
    xrayProcess.stdout.on('data', (data) => {
        console.log(`[Xray] ${data}`);
    });
    
    xrayProcess.stderr.on('data', (data) => {
        console.log(`[Xray] ${data}`);
    });
    
    xrayProcess.on('error', (error) => {
        console.error('❌ Xray error:', error.message);
    });
    
    console.log('🚀 Xray proxy started');
    return xrayProcess;
}

// راه‌اندازی Express Panel
function startPanel() {
    const app = express();
    
    app.use(cors());
    app.use(express.json());
    app.use(express.static('public'));

    // API: اطلاعات سرور و کانفیگ‌ها
    app.get('/api/info', (req, res) => {
        // ساخت لینک Vmess
        const vmessConfig = {
            v: "2",
            ps: "Railway-Xray-Vmess",
            add: RAILWAY_DOMAIN,
            port: "443",
            id: UUID,
            aid: "0",
            scy: "auto",
            net: "ws",
            type: "none",
            host: RAILWAY_DOMAIN,
            path: "/vmess-ws",
            tls: "tls",
            sni: RAILWAY_DOMAIN
        };
        
        const vmessLink = "vmess://" + Buffer.from(JSON.stringify(vmessConfig)).toString('base64');
        
        // ساخت لینک Vless
        const vlessLink = `vless://${UUID}@${RAILWAY_DOMAIN}:443?encryption=none&security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Fvless-ws#Railway-Xray-Vless`;
        
        // ساخت لینک Trojan
        const trojanPassword = UUID.substring(0, 16);
        const trojanLink = `trojan://${trojanPassword}@${RAILWAY_DOMAIN}:443?security=tls&sni=${RAILWAY_DOMAIN}&type=ws&host=${RAILWAY_DOMAIN}&path=%2Ftrojan-ws#Railway-Xray-Trojan`;
        
        res.json({
            success: true,
            domain: RAILWAY_DOMAIN,
            uuid: UUID,
            configs: {
                vmess: {
                    name: "Vmess + WebSocket + TLS",
                    link: vmessLink,
                    details: {
                        port: 8080,
                        network: "ws",
                        path: "/vmess-ws",
                        tls: true
                    }
                },
                vless: {
                    name: "Vless + WebSocket + TLS",
                    link: vlessLink,
                    details: {
                        port: 8081,
                        network: "ws",
                        path: "/vless-ws",
                        tls: true
                    }
                },
                trojan: {
                    name: "Trojan + WebSocket + TLS",
                    link: trojanLink,
                    details: {
                        port: 8082,
                        password: trojanPassword,
                        network: "ws",
                        path: "/trojan-ws",
                        tls: true
                    }
                }
            }
        });
    });
    
    // API: تست سلامت
    app.get('/api/health', (req, res) => {
        const xrayRunning = fs.existsSync(XRAY_PATH);
        res.json({
            status: 'online',
            xray: xrayRunning ? 'running' : 'not installed',
            domain: RAILWAY_DOMAIN,
            timestamp: new Date().toISOString()
        });
    });

    // صفحه اصلی
    app.get('/', (req, res) => {
        res.send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🚀 Railway Xray Panel</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            min-height: 100vh;
            padding: 2rem;
            color: white;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 3rem;
        }
        
        .header h1 {
            font-size: 2.5rem;
            background: linear-gradient(to right, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        
        .header p {
            color: #a0aec0;
            font-size: 1.1rem;
        }
        
        .status-banner {
            background: linear-gradient(135deg, #667eea33, #764ba233);
            border: 1px solid #667eea55;
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: #48c78e22;
            border: 1px solid #48c78e55;
            color: #48c78e;
            padding: 0.5rem 1rem;
            border-radius: 2rem;
            font-weight: bold;
        }
        
        .pulse {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #48c78e;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        
        .info-item {
            color: #a0aec0;
        }
        
        .info-item strong {
            color: white;
            font-family: monospace;
            font-size: 0.9rem;
        }
        
        .config-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
        }
        
        .config-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 1rem;
            padding: 1.5rem;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .config-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 32px rgba(102, 126, 234, 0.2);
        }
        
        .config-card h3 {
            font-size: 1.3rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .config-details {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        
        .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 0.5rem;
            font-size: 0.85rem;
        }
        
        .detail-label {
            color: #a0aec0;
        }
        
        .detail-value {
            font-family: monospace;
            color: #e2e8f0;
        }
        
        .config-link-box {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.5rem;
            padding: 0.75rem;
            margin: 1rem 0;
            word-break: break-all;
            font-family: monospace;
            font-size: 0.7rem;
            color: #a0aec0;
            max-height: 60px;
            overflow-y: auto;
        }
        
        .btn {
            width: 100%;
            padding: 0.75rem;
            border: none;
            border-radius: 0.5rem;
            font-size: 0.9rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        .btn-copy {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        
        .btn-copy:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        .btn-copy:active {
            transform: translateY(0);
        }
        
        .toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #48c78e;
            color: white;
            padding: 1rem 2rem;
            border-radius: 0.5rem;
            z-index: 1000;
            animation: slideDown 0.3s ease;
        }
        
        @keyframes slideDown {
            from {
                transform: translate(-50%, -100%);
                opacity: 0;
            }
            to {
                transform: translate(-50%, 0);
                opacity: 1;
            }
        }
        
        .loading {
            text-align: center;
            padding: 2rem;
            color: #a0aec0;
        }
        
        .spinner {
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-top-color: #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Railway Xray Panel</h1>
            <p>کانفیگ‌های V2Ray رایگان روی Railway</p>
        </div>
        
        <div class="status-banner">
            <div class="status-badge">
                <div class="pulse"></div>
                آنلاین
            </div>
            <div class="info-item">
                دامنه: <strong id="domain">${RAILWAY_DOMAIN}</strong>
            </div>
            <div class="info-item">
                UUID: <strong id="uuid-display">${UUID.substring(0, 8)}...</strong>
            </div>
        </div>

        <div id="configs-container" class="loading">
            <div class="spinner"></div>
            <p>در حال بارگذاری کانفیگ‌ها...</p>
        </div>
    </div>

    <script>
        async function loadConfigs() {
            try {
                const response = await fetch('/api/info');
                const data = await response.json();
                
                const configsHtml = Object.entries(data.configs).map(([key, cfg]) => {
                    const icons = {
                        vmess: '📡',
                        vless: '⚡',
                        trojan: '🔐'
                    };
                    
                    return \`
                        <div class="config-card">
                            <h3>\${icons[key] || '🔧'} \${cfg.name}</h3>
                            <div class="config-details">
                                <div class="detail-row">
                                    <span class="detail-label">پروتکل:</span>
                                    <span class="detail-value">\${key.toUpperCase()}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">شبکه:</span>
                                    <span class="detail-value">WebSocket</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">TLS:</span>
                                    <span class="detail-value" style="color: #48c78e;">✅ فعال</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">مسیر:</span>
                                    <span class="detail-value">\${cfg.details.path}</span>
                                </div>
                            </div>
                            <div class="config-link-box" id="link-\${key}">\${cfg.link}</div>
                            <button class="btn btn-copy" onclick="copyConfig('link-\${key}', '\${key.toUpperCase()}')">
                                📋 کپی کانفیگ \${key.toUpperCase()}
                            </button>
                        </div>
                    \`;
                }).join('');
                
                document.getElementById('configs-container').innerHTML = configsHtml;
                document.getElementById('configs-container').classList.remove('loading');
            } catch (error) {
                document.getElementById('configs-container').innerHTML = \`
                    <div style="text-align: center; padding: 2rem; color: #fc8181;">
                        <p>❌ خطا در بارگذاری کانفیگ‌ها</p>
                        <button class="btn btn-copy" onclick="location.reload()" style="margin-top: 1rem; width: auto;">
                            🔄 بارگذاری مجدد
                        </button>
                    </div>
                \`;
            }
        }

        function copyConfig(elementId, type) {
            const element = document.getElementById(elementId);
            const text = element.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                showToast('✅ کانفیگ ' + type + ' با موفقیت کپی شد!');
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                try {
                    document.execCommand('copy');
                    showToast('✅ کانفیگ ' + type + ' با موفقیت کپی شد!');
                } catch (err) {
                    showToast('❌ خطا در کپی کردن. لطفاً دستی کپی کنید.');
                }
                document.body.removeChild(textarea);
            });
        }

        function showToast(message) {
            const existingToast = document.querySelector('.toast');
            if (existingToast) existingToast.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.remove();
            }, 3000);
        }

        // Load configs on page load
        loadConfigs();
    </script>
</body>
</html>`);
    });

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
        console.log('='.repeat(50));
        console.log('🚀 Railway Xray Panel Started!');
        console.log('='.repeat(50));
        console.log(`📡 Domain: ${RAILWAY_URL}`);
        console.log(`🔑 UUID: ${UUID}`);
        console.log(`🌐 Panel: http://0.0.0.0:${PORT}`);
        console.log('='.repeat(50));
    });
}

// تابع اصلی
async function main() {
    console.log('🚀 Starting Railway Xray Panel...');
    
    // دانلود Xray
    const xrayInstalled = await downloadXray();
    
    // اجرای Xray
    if (xrayInstalled) {
        startXray();
    }
    
    // اجرای پنل
    startPanel();
}

// اجرا
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
