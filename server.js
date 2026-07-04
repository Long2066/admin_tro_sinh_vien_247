const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

// Quản lý session trong bộ nhớ tạm (In-memory Sessions)
const sessions = {};

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

// Kiểm tra phiên làm việc của Admin
function isAuthenticated(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies['admin_session_id'];
    return sessionId && sessions[sessionId] && sessions[sessionId].expires > Date.now();
}

// Hàm gửi request proxy đến server dự án chính (port 3000)
function proxyToMainServer(req, res, targetPath, method, body = '') {
    const token = getMainSecretToken();
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: targetPath,
        method: method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Admin-Token': token
        }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        });
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error("[ADMIN SERVER] Lỗi kết nối tới Main Server:", err.message);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Không thể kết nối tới máy chủ chính (port 3000)', details: err.message }));
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
                // Tạo sessionId ngẫu nhiên
                const sessionId = 'sess-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                const expiryTime = Date.now() + 3600 * 1000; // Hạn dùng 1 giờ

                sessions[sessionId] = {
                    username: credentials.username,
                    expires: expiryTime
                };

                // Thiết lập HttpOnly Cookie bảo mật
                res.writeHead(200, {
                    'Set-Cookie': `admin_session_id=${sessionId}; Path=/; HttpOnly; Max-Age=3600; SameSite=Lax`,
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
        const cookies = parseCookies(req);
        const sessionId = cookies['admin_session_id'];
        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }
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
