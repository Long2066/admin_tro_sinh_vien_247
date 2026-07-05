const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = 3001;

// Đường dẫn file cấu hình dự án Admin và dự án chính
const adminConfigPath = path.join(__dirname, 'admin_config.json');
const mainConfigPath = path.join(__dirname, '..', 'student-room-finder', 'config.json');

// Khởi tạo cấu hình tài khoản Admin mặc định
function getAdminConfig() {
    let config = { username: "longk2tha@gmail.com", password: "Long2006@" };
    if (fs.existsSync(adminConfigPath)) {
        try {
            config = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
        } catch (e) {}
    } else {
        try {
            fs.writeFileSync(adminConfigPath, JSON.stringify(config, null, 2), 'utf8');
        } catch (e) {}
    }
    return config;
}

// Lấy mã Token bảo mật của dự án chính để gọi API
function getMainSecretToken() {
    try {
        if (fs.existsSync(mainConfigPath)) {
            const config = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
            return config.adminSecretToken || 'admin_secret_token_123';
        }
    } catch (e) {
        console.error("[ADMIN SERVER] Không đọc được file config của dự án chính:", e.message);
    }
    return 'admin_secret_token_123';
}

// Cấu hình mã hóa Session không trạng thái (Stateless Session) cho Vercel
const SESSION_SECRET = process.env.SESSION_SECRET || 'stayhub_secret_session_key_2026';

function generateSessionToken(username) {
    const expires = Date.now() + 24 * 3600 * 1000; // Hạn dùng 24h
    const data = `${username}:${expires}`;
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
    return Buffer.from(`${data}:${signature}`).toString('base64');
}

function verifySessionToken(token) {
    if (!token) return null;
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return null;
        
        const username = parts[0];
        const expires = parseInt(parts[1], 10);
        const signature = parts[2];
        
        if (expires < Date.now()) return null;
        
        const expectedData = `${username}:${expires}`;
        const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(expectedData).digest('hex');
        
        if (signature === expectedSignature) {
            return { username };
        }
    } catch (e) {}
    return null;
}

// Helper phân tích Cookie
function parseCookies(request) {
    const list = {};
    const rc = request.headers.cookie;
    if (rc) {
        rc.split(';').forEach((cookie) => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list;
}

// Kiểm tra phiên làm việc của Admin (Stateless)
function isAuthenticated(req) {
    const cookies = parseCookies(req);
    const sessionToken = cookies['admin_session_id'];
    return verifySessionToken(sessionToken) !== null;
}

// Cấu hình kết nối tới server chính (dùng biến môi trường hoặc mặc định tên miền chính thức trên Vercel)
const isProd = !!process.env.VERCEL;
const MAIN_HOST = process.env.MAIN_SERVER_HOST || (isProd ? 'tro-sinh-vien-247.vercel.app' : 'localhost');
const MAIN_PORT = process.env.MAIN_SERVER_PORT ? parseInt(process.env.MAIN_SERVER_PORT, 10) : (isProd ? 443 : 3000);
const MAIN_PROTOCOL = process.env.MAIN_SERVER_PROTOCOL || (isProd ? 'https' : 'http');

// Hàm gửi request proxy đến server dự án chính (tự động đổi HTTP/HTTPS tùy môi trường)
function proxyToMainServer(req, res, targetPath, method, body = '') {
    const token = getMainSecretToken();
    const options = {
        hostname: MAIN_HOST,
        port: MAIN_PORT,
        path: targetPath,
        method: method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Admin-Token': token
        }
    };

    const requestModule = MAIN_PROTOCOL === 'https' ? https : http;

    const proxyReq = requestModule.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        });
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error("[ADMIN SERVER] Lỗi kết nối tới Main Server:", err.message);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ 
            error: 'Không thể kết nối tới máy chủ chính', 
            details: err.message,
            target: `${MAIN_PROTOCOL}://${MAIN_HOST}:${MAIN_PORT}${targetPath}`
        }));
    });

    if (body) {
        proxyReq.write(body);
    }
    proxyReq.end();
}

// Hàm xử lý request chính
const requestHandler = async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Helper trích xuất request body
    const getRequestBody = (request) => {
        return new Promise((resolve, reject) => {
            let body = '';
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => resolve(body));
            request.on('error', err => reject(err));
        });
    };

    // 1. ENDPOINT: Đăng nhập tài khoản
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        try {
            const body = await getRequestBody(req);
            const credentials = JSON.parse(body);
            const adminConfig = getAdminConfig();

            if (credentials.username === adminConfig.username && credentials.password === adminConfig.password) {
                // Tạo session token bảo mật mã hóa HMAC không trạng thái
                const sessionToken = generateSessionToken(credentials.username);

                // Thiết lập HttpOnly Cookie bảo mật (Hạn dùng 24 giờ)
                res.writeHead(200, {
                    'Set-Cookie': `admin_session_id=${sessionToken}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax`,
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({ success: true, message: 'Đăng nhập thành công!' }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Tên tài khoản hoặc mật khẩu không chính xác!' }));
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Lỗi xử lý đăng nhập', details: e.message }));
        }
        return;
    }

    // 2. ENDPOINT: Đăng xuất
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
        res.writeHead(200, {
            'Set-Cookie': `admin_session_id=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`,
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // 3. ENDPOINT: Kiểm tra trạng thái đăng nhập
    if (pathname === '/api/auth/status' && req.method === 'GET') {
        const loggedIn = isAuthenticated(req);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ loggedIn: loggedIn }));
        return;
    }

    // 4. CHẶN VÀ CHUYỂN TIẾP (PROXY) CÁC API ADMIN CỦA DỰ ÁN CHÍNH
    if (pathname.startsWith('/api/admin')) {
        // Kiểm tra đăng nhập
        if (!isAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Phiên làm việc hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại!' }));
            return;
        }

        // Đọc dữ liệu body nếu có (chỉ áp dụng cho POST/PUT/DELETE)
        let body = '';
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
            body = await getRequestBody(req);
        }

        // Proxy request sang Main Server (port 3000)
        proxyToMainServer(req, res, req.url, req.method, body);
        return;
    }

    // 5. PHỤC VỤ CÁC FILE STATIC CHO GIAO DIỆN ADMIN
    let rawPath = pathname === '/' ? '/index.html' : pathname;
    
    // Nếu chưa đăng nhập và muốn vào trang chính Dashboard, chuyển hướng về login.html
    if (rawPath === '/index.html' && !isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/login.html' });
        res.end();
        return;
    }

    // Nếu đã đăng nhập mà cố tình vào login.html, chuyển hướng về index.html
    if (rawPath === '/login.html' && isAuthenticated(req)) {
        res.writeHead(302, { 'Location': '/index.html' });
        res.end();
        return;
    }

    let filePath = path.join(__dirname, rawPath);
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Access Denied');
        return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>404 Not Found</h1><p>File không tồn tại trên Admin Server.</p>');
            } else {
                res.writeHead(500);
                res.end(`Admin Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
};

const server = http.createServer(requestHandler);

if (!process.env.VERCEL) {
    server.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`🔑 [ADMIN SERVER KHỞI CHẠY] Cổng quản trị đang hoạt động!`);
        console.log(`👉 Đăng nhập quản trị: http://localhost:${PORT}`);
        console.log(`======================================================\n`);
    });
}

module.exports = requestHandler;
