// Quản lý trạng thái giao diện Admin
let adminState = {
    activeTab: 'fb-scraper',
    landlordRooms: [],
    map: null,
    clickMarker: null,
    selectedImages: []
};

// Khởi chạy khi DOM được tải xong
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Kiểm tra xác thực trước khi chạy các logic khác
    const isAuthenticated = await checkAuthStatus();
    if (!isAuthenticated) return; // Đã chuyển hướng ở checkAuthStatus

    // 2. Khởi tạo các thành phần giao diện
    initTabs();
    initFbScraperPanel();
    initLandlordPanel();
    initLogout();

    // Cập nhật huy hiệu tin chờ duyệt ban đầu
    updatePendingBadge();
});

// ==========================================
// 1. QUẢN LÝ XÁC THỰC & ĐĂNG XUẤT
// ==========================================

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        if (!data.loggedIn) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    } catch (e) {
        console.error("Lỗi kiểm tra auth:", e);
        window.location.href = '/login.html';
        return false;
    }
}

function initLogout() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (confirm("Bạn có chắc chắn muốn đăng xuất khỏi hệ thống admin?")) {
            try {
                const response = await fetch('/api/auth/logout', { method: 'POST' });
                if (response.ok) {
                    window.location.href = '/login.html';
                }
            } catch (e) {
                showToast("Lỗi kết nối khi đăng xuất!", true);
            }
        }
    });
}

// ==========================================
// 2. ĐIỀU HƯỚNG TABS
// ==========================================

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');
            adminState.activeTab = targetTab;

            // Invalidate kích thước map khi chuyển sang tab landlord manager để tránh bị lỗi hiển thị
            if (targetTab === 'landlord-manager' && adminState.map) {
                setTimeout(() => adminState.map.invalidateSize(), 200);
            }

            // Tải danh sách kiểm duyệt khi chuyển sang tab duyệt
            if (targetTab === 'pending-approvals') {
                loadPendingRooms();
            }
        });
    });
}

// ==========================================
// 3. TAB 1: FACEBOOK SCRAPER LOGIC
// ==========================================

function initFbScraperPanel() {
    loadFbConfig();

    // Sự kiện Lưu Cấu hình
    document.getElementById('save-config-btn').addEventListener('click', saveFbConfig);

    // Sự kiện Kích hoạt Cào dữ liệu
    document.getElementById('start-crawl-btn').addEventListener('click', startCrawl);

    // Sự kiện Làm mới Logs
    document.getElementById('refresh-logs-btn').addEventListener('click', fetchCrawlLogs);

    // Tự động tải logs lần đầu
    fetchCrawlLogs();
}

async function loadFbConfig() {
    try {
        const res = await fetch('/api/admin/config');
        if (!res.ok) throw new Error("Unauthorized");
        const config = await res.json();

        document.getElementById('admin-fb-cookie').value = config.fbCookie || '';
        
        if (Array.isArray(config.fbGroups)) {
            document.getElementById('admin-fb-groups').value = config.fbGroups.join('\n');
        } else {
            document.getElementById('admin-fb-groups').value = '';
        }
    } catch (e) {
        console.error("Lỗi tải cấu hình Facebook:", e.message);
    }
}

async function saveFbConfig() {
    const cookie = document.getElementById('admin-fb-cookie').value.trim();
    const groupsRaw = document.getElementById('admin-fb-groups').value.trim();
    
    // Tách dòng thành mảng
    const groups = groupsRaw.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const configData = {
        fbCookie: cookie,
        fbGroups: groups
    };

    const saveBtn = document.getElementById('save-config-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

    try {
        const res = await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configData)
        });

        if (res.ok) {
            showToast("Đã lưu cấu hình Facebook thành công!", false);
        } else {
            showToast("Lỗi lưu cấu hình. Phiên đăng nhập hết hạn!", true);
        }
    } catch (e) {
        showToast("Lỗi kết nối máy chủ khi lưu cấu hình!", true);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Cấu Hình';
    }
}

async function startCrawl() {
    const startBtn = document.getElementById('start-crawl-btn');
    const badge = document.getElementById('crawl-status-badge');

    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang chạy ngầm...';
    badge.className = "badge badge-running";
    badge.textContent = "Đang chạy cào";

    try {
        const res = await fetch('/api/admin/crawl', { method: 'POST' });
        if (res.ok) {
            showToast("Đã gửi lệnh chạy cào ngầm thành công! Hãy theo dõi logs.", false);
            // Poll logs liên tục sau mỗi 3 giây trong vòng 15 giây đầu
            let count = 0;
            const logInterval = setInterval(() => {
                fetchCrawlLogs();
                count++;
                if (count > 5) clearInterval(logInterval);
            }, 3000);
        } else {
            showToast("Lỗi kích hoạt tiến trình cào!", true);
            badge.className = "badge badge-danger";
            badge.textContent = "Lỗi khởi chạy";
        }
    } catch (e) {
        showToast("Lỗi kết nối máy chủ cào dữ liệu!", true);
        badge.className = "badge badge-danger";
        badge.textContent = "Lỗi kết nối";
    } finally {
        setTimeout(() => {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Bắt đầu cào ngay lập tức';
        }, 2000);
    }
}

async function fetchCrawlLogs() {
    const consoleDiv = document.getElementById('admin-console-log');
    const badge = document.getElementById('crawl-status-badge');
    try {
        const res = await fetch('/api/admin/logs');
        if (res.ok) {
            const logs = await res.text();
            consoleDiv.textContent = logs;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;

            // Phân tích logs để cập nhật lại trạng thái badge
            if (logs.includes("🎉 HOÀN THÀNH TIẾN TRÌNH CÀO DỮ LIỆU!")) {
                badge.className = "badge badge-warning";
                badge.textContent = "Hoàn thành";
            } else if (logs.includes("❌ LỖI TIẾN TRÌNH") || logs.includes("❌ Lỗi kết nối")) {
                badge.className = "badge badge-danger";
                badge.textContent = "Thất bại";
            }
        } else {
            consoleDiv.textContent = "Không có quyền xem logs hoặc phiên đăng nhập hết hạn.";
        }
    } catch (e) {
        consoleDiv.textContent = "Lỗi kết nối khi tải logs hệ thống.";
    }
}

// ==========================================
// 4. TAB 2: QUẢN LÝ PHÒNG TRỌ LOGIC (LANDLORD)
// ==========================================

function initLandlordPanel() {
    initAdminMap();
    loadLandlordRooms();

    // Sự kiện AI bóc tách
    document.getElementById('ai-fill-btn').addEventListener('click', parseRoomDescription);

    // Sự kiện Đăng tin
    document.getElementById('submit-room-btn').addEventListener('click', submitLandlordRoom);

    // Sự kiện chọn ảnh
    document.getElementById('landlord-images').addEventListener('change', handleImageSelect);
}

// Xử lý sự kiện chọn file ảnh
function handleImageSelect(e) {
    const files = Array.from(e.target.files);
    
    if (adminState.selectedImages.length + files.length > 4) {
        showToast("Tối đa chỉ được chọn 4 hình ảnh!", true);
        const spaceLeft = 4 - adminState.selectedImages.length;
        files.splice(spaceLeft);
    }

    let loadedCount = 0;
    if (files.length === 0) return;
    
    files.forEach(file => {
        if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
            showToast(`File ${file.name} không đúng định dạng PNG/JPG!`, true);
            return;
        }

        if (file.size > 3 * 1024 * 1024) {
            showToast(`File ${file.name} vượt quá dung lượng tối đa 3MB!`, true);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Str = event.target.result;
            if (!adminState.selectedImages.includes(base64Str)) {
                adminState.selectedImages.push(base64Str);
            }
            loadedCount++;
            if (loadedCount === files.length || adminState.selectedImages.length === 4) {
                renderImagePreviews();
            }
        };
        reader.readAsDataURL(file);
    });

    e.target.value = '';
}

// Hiển thị danh sách ảnh xem trước
function renderImagePreviews() {
    const container = document.getElementById('image-previews');
    const statusLabel = document.getElementById('upload-status-label');
    container.innerHTML = '';

    statusLabel.textContent = `Đã chọn ${adminState.selectedImages.length}/4 ảnh`;

    adminState.selectedImages.forEach((base64Str, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-img-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.width = '70px';
        wrapper.style.height = '70px';

        const img = document.createElement('img');
        img.src = base64Str;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        img.style.border = '1px solid var(--border-color)';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-preview-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.top = '-6px';
        deleteBtn.style.right = '-6px';
        deleteBtn.style.background = 'var(--color-danger)';
        deleteBtn.style.color = 'white';
        deleteBtn.style.border = 'none';
        deleteBtn.style.width = '18px';
        deleteBtn.style.height = '18px';
        deleteBtn.style.borderRadius = '50%';
        deleteBtn.style.display = 'flex';
        deleteBtn.style.alignItems = 'center';
        deleteBtn.style.justifyContent = 'center';
        deleteBtn.style.fontSize = '12px';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';

        deleteBtn.onclick = () => {
            adminState.selectedImages.splice(index, 1);
            renderImagePreviews();
        };

        wrapper.appendChild(img);
        wrapper.appendChild(deleteBtn);
        container.appendChild(wrapper);
    });
}

function initAdminMap() {
    // Hà Nội Center
    const defaultCenter = [21.012, 105.825];
    
    adminState.map = L.map('admin-map', {
        zoomControl: true
    }).setView(defaultCenter, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(adminState.map);

    // Click vào bản đồ để điền kinh vĩ độ
    adminState.map.on('click', (e) => {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;

        document.getElementById('landlord-lat').value = lat.toFixed(6);
        document.getElementById('landlord-lon').value = lon.toFixed(6);

        // Ghim marker định vị trên map
        if (adminState.clickMarker) {
            adminState.clickMarker.setLatLng(e.latlng);
        } else {
            adminState.clickMarker = L.marker(e.latlng).addTo(adminState.map);
        }

        // Gọi API Nominatim để lấy tên địa chỉ (Reverse Geocoding)
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
            headers: { 'User-Agent': 'SmartRoomFinderAdmin/1.0' }
        })
        .then(res => res.json())
        .then(data => {
            if (data && data.display_name) {
                // Rút ngắn địa chỉ cho đẹp
                const cleanAddr = data.display_name.split(',').slice(0, 4).join(',').trim();
                document.getElementById('landlord-address').value = cleanAddr;
            }
        })
        .catch(err => console.log("Không dịch được địa chỉ tọa độ click:", err));
    });
}

function parseRoomDescription() {
    const text = document.getElementById('landlord-ai-input').value.trim();
    if (!text) {
        showToast("Vui lòng dán đoạn mô tả phòng trọ cần bóc tách!", true);
        return;
    }

    // 1. Số điện thoại
    const phoneRegex = /(?:(?:\+84|84|0)[35789])(?:[\s\.-]*\d){8}\b/;
    const phoneMatch = text.match(phoneRegex);
    if (phoneMatch) {
        document.getElementById('landlord-phone').value = phoneMatch[0].replace(/[\s\.-]/g, '').replace(/^(\+84|84)/, '0');
    }

    // 2. Giá thuê
    const priceRegex = /(\d+[\.,]?\d*)\s*(tr|triệu|trieu|đ|d)\b/i;
    const priceMatch = text.match(priceRegex);
    let price = 0;
    if (priceMatch) {
        let val = parseFloat(priceMatch[1].replace(',', '.'));
        if (priceMatch[2].toLowerCase().includes('tr')) {
            price = val * 1000000;
        } else {
            price = val;
        }
        document.getElementById('landlord-price').value = price;
    }

    // 3. Tiền cọc
    const depositRegex = /(?:cọc|đặt cọc|tiền cọc)\s*(\d+[\.,]?\d*)\s*(tr|triệu|trieu|đ|d)?\b/i;
    const depositMatch = text.match(depositRegex);
    if (depositMatch) {
        let val = parseFloat(depositMatch[1].replace(',', '.'));
        let dep = val;
        if (depositMatch[2] && depositMatch[2].toLowerCase().includes('tr')) {
            dep = val * 1000000;
        } else if (val < 100) {
            dep = val * 1000000;
        }
        document.getElementById('landlord-deposit').value = dep;
    } else if (price > 0) {
        document.getElementById('landlord-deposit').value = price;
    }

    // 4. Người liên hệ
    const nameRegex = /(?:liên hệ|lh|gặp|chủ trọ|chủ nhà)\s+(?:bác|anh|chị|cô|chú)?\s*([A-ZĐ][a-zà-ỹ]+(?:\s+[A-ZĐ][a-zà-ỹ]+){0,2})/i;
    const nameMatch = text.match(nameRegex);
    if (nameMatch) {
        document.getElementById('landlord-owner-name').value = nameMatch[1].trim();
    } else {
        document.getElementById('landlord-owner-name').value = "Chủ trọ";
    }

    // 5. Địa chỉ sơ bộ
    const addrRegex = /(?:ở|tại|ngõ|ngách|số|đường|phố)\s+([0-9A-Za-zà-ỹ\s,]{5,50})/i;
    const addrMatch = text.match(addrRegex);
    if (addrMatch) {
        document.getElementById('landlord-address').value = addrMatch[0].trim();
    }

    // 6. Tiêu đề
    let title = "Phòng trọ khép kín đầy đủ tiện nghi";
    if (text.toLowerCase().includes("ở ghép")) title = "Nhượng phòng trọ / Tìm người ở ghép";
    else if (text.toLowerCase().includes("chung cư mini")) title = "Cho thuê chung cư mini khép kín";
    
    document.getElementById('landlord-title').value = title;

    // 7. Tiện nghi
    const amenitiesList = [
        { id: 'AC', keys: ['điều hòa', 'điều hoà', 'máy lạnh', 'ac'] },
        { id: 'Wifi', keys: ['wifi', 'mạng', 'internet'] },
        { id: 'Bed', keys: ['giường'] },
        { id: 'Wardrobe', keys: ['tủ quần áo', 'tủ đồ', 'tủ âm tường'] },
        { id: 'Heater', keys: ['nóng lạnh', 'nước nóng', 'bình nóng'] },
        { id: 'Fridge', keys: ['tủ lạnh', 'fridge'] },
        { id: 'Balcony', keys: ['ban công', 'cửa sổ'] },
        { id: 'Kitchen', keys: ['bếp', 'nấu ăn'] },
        { id: 'WashingMachine', keys: ['máy giặt', 'giặt đồ'] }
    ];

    const checkboxes = document.querySelectorAll('#landlord-checkboxes input');
    checkboxes.forEach(cb => {
        const spec = amenitiesList.find(a => a.id === cb.value);
        if (spec) {
            cb.checked = spec.keys.some(key => text.toLowerCase().includes(key));
        }
    });

    // Điền mô tả chi tiết
    document.getElementById('landlord-desc').value = text;

    showToast("AI phân tích mô tả và điền form thành công!", false);
}

async function loadLandlordRooms() {
    const listDiv = document.getElementById('admin-rooms-list');
    try {
        const res = await fetch('/api/admin/landlord-rooms');
        if (!res.ok) throw new Error("Unauthorized");
        const rooms = await res.json();
        adminState.landlordRooms = rooms;

        document.getElementById('landlord-rooms-count').textContent = rooms.length;
        renderAdminRoomsList(rooms);
    } catch (e) {
        listDiv.innerHTML = '<div class="error-msg">Không thể kết nối máy chủ để tải danh sách phòng.</div>';
    }
}

function renderAdminRoomsList(rooms) {
    const listDiv = document.getElementById('admin-rooms-list');
    listDiv.innerHTML = '';

    if (rooms.length === 0) {
        listDiv.innerHTML = '<div class="empty-list">Bạn chưa đăng tải phòng trọ nào.</div>';
        return;
    }

    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'admin-room-card';
        
        const hasImage = Array.isArray(room.images) && room.images.length > 0;
        const thumbnailHtml = hasImage 
            ? `<img src="${room.images[0]}" class="room-thumbnail" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); flex-shrink: 0;">`
            : `<div class="room-thumbnail-placeholder" style="width: 50px; height: 50px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-muted);"><i class="fa-solid fa-image"></i></div>`;

        card.innerHTML = `
            ${thumbnailHtml}
            <div class="room-info" style="margin-left: 12px;">
                <div class="room-title-line">
                    <strong class="title">${room.title}</strong>
                    <span class="price">${(room.price / 1000000).toFixed(1)}Tr/tháng</span>
                </div>
                <div class="room-meta-line">
                    <span><i class="fa-solid fa-location-dot"></i> ${room.standardizedAddress || room.address.split(',').slice(0, 3).join(',')}</span>
                    <span><i class="fa-solid fa-phone"></i> ${room.contactPhone} (${room.ownerName})</span>
                </div>
            </div>
            <button class="btn-delete" onclick="deleteRoom('${room.id}')" title="Xóa phòng trọ">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        listDiv.appendChild(card);
    });
}

// Hàm xóa phòng trọ global để onclick gọi được
window.deleteRoom = async function(id) {
    if (confirm("Bạn có chắc chắn muốn xóa vĩnh viễn phòng trọ này khỏi bản đồ chính?")) {
        try {
            const res = await fetch(`/api/admin/landlord-rooms?id=${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                showToast("Đã xóa phòng trọ thành công!", false);
                loadLandlordRooms();
            } else {
                showToast("Lỗi xóa phòng trọ từ máy chủ!", true);
            }
        } catch (e) {
            showToast("Lỗi kết nối khi thực hiện xóa!", true);
        }
    }
};

async function submitLandlordRoom() {
    const title = document.getElementById('landlord-title').value.trim();
    const price = document.getElementById('landlord-price').value.trim();
    const deposit = document.getElementById('landlord-deposit').value.trim();
    const phone = document.getElementById('landlord-phone').value.trim();
    const ownerName = document.getElementById('landlord-owner-name').value.trim() || 'Chủ trọ';
    const address = document.getElementById('landlord-address').value.trim();
    const latRaw = document.getElementById('landlord-lat').value.trim();
    const lonRaw = document.getElementById('landlord-lon').value.trim();
    const description = document.getElementById('landlord-desc').value.trim();

    // Validate
    if (!title || !price || !phone || !address || !latRaw || !lonRaw) {
        showToast("Vui lòng điền đầy đủ các thông tin có dấu (*)", true);
        return;
    }

    if (adminState.selectedImages.length === 0) {
        showToast("Vui lòng tải lên ít nhất 1 hình ảnh phòng trọ!", true);
        return;
    }

    // Lấy các tiện nghi đã chọn
    const amenities = [];
    document.querySelectorAll('#landlord-checkboxes input:checked').forEach(cb => {
        amenities.push(cb.value);
    });

    const roomData = {
        title: title,
        price: parseFloat(price),
        deposit: parseFloat(deposit || price),
        contactPhone: phone,
        ownerName: ownerName,
        address: address,
        coords: [parseFloat(latRaw), parseFloat(lonRaw)],
        amenities: amenities,
        description: description,
        images: adminState.selectedImages
    };

    const submitBtn = document.getElementById('submit-room-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải lên...';

    try {
        const res = await fetch('/api/admin/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roomData)
        });

        if (res.ok) {
            showToast("Đăng tin phòng trọ lên bản đồ chính thành công!", false);
            resetLandlordForm();
            loadLandlordRooms();
        } else {
            showToast("Lỗi đăng tin phòng trọ. Phiên đăng nhập hết hạn!", true);
        }
    } catch (e) {
        showToast("Lỗi kết nối mạng khi gửi tin phòng trọ!", true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Đăng Phòng Lên Bản Đồ Chính';
    }
}

function resetLandlordForm() {
    document.getElementById('landlord-title').value = '';
    document.getElementById('landlord-price').value = '';
    document.getElementById('landlord-deposit').value = '';
    document.getElementById('landlord-phone').value = '';
    document.getElementById('landlord-owner-name').value = '';
    document.getElementById('landlord-address').value = '';
    document.getElementById('landlord-lat').value = '';
    document.getElementById('landlord-lon').value = '';
    document.getElementById('landlord-desc').value = '';
    document.getElementById('landlord-ai-input').value = '';

    document.querySelectorAll('#landlord-checkboxes input').forEach(cb => {
        cb.checked = false;
    });

    if (adminState.clickMarker && adminState.map) {
        adminState.map.removeLayer(adminState.clickMarker);
        adminState.clickMarker = null;
    }

    // Reset images
    adminState.selectedImages = [];
    renderImagePreviews();
}

// ==========================================
// 5. HELPER TOAST NOTIFICATION
// ==========================================

function showToast(message, isError = false) {
    const toast = document.getElementById('toast-notification');
    const toastIcon = document.getElementById('toast-icon');
    const toastMsg = document.getElementById('toast-message');

    toastMsg.textContent = message;
    
    if (isError) {
        toast.classList.add('error');
        toastIcon.className = "fa-solid fa-circle-xmark";
        toastIcon.style.color = "#ef4444";
    } else {
        toast.classList.remove('error');
        toastIcon.className = "fa-solid fa-check-circle";
        toastIcon.style.color = "var(--color-primary)";
    }

    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==========================================
// 6. PHÂN HỆ KIỂM DUYỆT TIN ĐĂNG (USER POSTS)
// ==========================================

async function loadPendingRooms() {
    const listDiv = document.getElementById('pending-rooms-list');
    try {
        const res = await fetch('/api/admin/pending-rooms');
        if (!res.ok) throw new Error("Unauthorized");
        const rooms = await res.json();

        // Cập nhật huy hiệu
        updatePendingBadgeCount(rooms.length);

        renderPendingRoomsList(rooms);
    } catch (e) {
        listDiv.innerHTML = '<div class="error-msg" style="grid-column: 1 / -1;">Không thể tải danh sách kiểm duyệt.</div>';
    }
}

async function updatePendingBadge() {
    try {
        const res = await fetch('/api/admin/pending-rooms');
        if (res.ok) {
            const rooms = await res.json();
            updatePendingBadgeCount(rooms.length);
        }
    } catch (e) {}
}

function updatePendingBadgeCount(count) {
    const badge = document.getElementById('pending-badge-count');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function renderPendingRoomsList(rooms) {
    const container = document.getElementById('pending-rooms-list');
    container.innerHTML = '';

    if (rooms.length === 0) {
        container.innerHTML = '<div class="empty-list" style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted);">Không có tin đăng nào đang chờ duyệt.</div>';
        return;
    }

    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'card pending-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '12px';
        card.style.border = '1px solid var(--border-color)';
        
        // Trạng thái GPS
        let gpsLabel = '';
        if (room.gpsDistanceKm === null) {
            gpsLabel = `<span class="badge" style="background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.25);"><i class="fa-solid fa-location-crosshairs"></i> GPS: Không xác định</span>`;
        } else if (room.gpsDistanceKm <= 0.3) {
            gpsLabel = `<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3);"><i class="fa-solid fa-location-dot"></i> Khớp GPS (Độ lệch: ${room.gpsDistanceKm * 1000}m)</span>`;
        } else {
            gpsLabel = `<span class="badge" style="background: rgba(234,88,12,0.15); color: #fb923c; border: 1px solid rgba(234,88,12,0.3);"><i class="fa-solid fa-triangle-exclamation"></i> GPS lệch: ${room.gpsDistanceKm}km</span>`;
        }

        // Điểm rủi ro
        let scoreColor = '#34d399';
        let scoreLabel = 'AN TOÀN';
        if (room.riskScore < 50) {
            scoreColor = '#f87171';
            scoreLabel = 'CẢNH BÁO LỪA ĐẢO';
        } else if (room.riskScore < 80) {
            scoreColor = '#fb923c';
            scoreLabel = 'CẦN CHÚ Ý';
        }

        const riskBadge = `<span class="badge" style="background: ${scoreColor}20; color: ${scoreColor}; border: 1px solid ${scoreColor}40;">${scoreLabel} (${room.riskScore} điểm)</span>`;

        // Render Red Flags
        let redFlagsHtml = '';
        if (Array.isArray(room.redFlags) && room.redFlags.length > 0) {
            redFlagsHtml = `
                <div style="background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15); padding: 8px 12px; border-radius: 6px; font-size: 12px; color: #f87171;">
                    <strong style="display:block; margin-bottom: 2px;"><i class="fa-solid fa-circle-exclamation"></i> Dấu hiệu nghi vấn:</strong>
                    <ul style="margin: 0; padding-left: 16px;">
                        ${room.redFlags.map(flag => `<li>${flag}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Render ảnh phòng trọ carousel
        let imagesHtml = '';
        if (Array.isArray(room.images) && room.images.length > 0) {
            imagesHtml = `
                <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px;">
                    ${room.images.map(img => `
                        <img src="${img}" style="width: 75px; height: 75px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); cursor: pointer;" onclick="window.open('${img}', '_blank')">
                    `).join('')}
                </div>
            `;
        }

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <h4 style="margin: 0; font-size: 14.5px; font-weight: 700; color: white;">${room.title}</h4>
                <span style="font-family: var(--font-heading); font-size: 15px; font-weight: 700; color: var(--color-primary); white-space: nowrap;">${(room.price / 1000000).toFixed(1)} Tr/tháng</span>
            </div>
            
            <div style="font-size: 12.5px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                <span><i class="fa-solid fa-location-dot" style="width: 14px;"></i> ${room.standardizedAddress || room.address}</span>
                <span><i class="fa-solid fa-phone" style="width: 14px;"></i> <strong>${room.contactPhone}</strong> (${room.ownerName})</span>
            </div>

            ${imagesHtml}

            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${gpsLabel}
                ${riskBadge}
            </div>

            ${redFlagsHtml}

            <div style="margin-top: auto; display: flex; gap: 10px; padding-top: 10px; border-top: 1px solid var(--border-color);">
                <button class="btn" style="background: #22c55e; color: white; flex: 1; justify-content: center; font-size: 12.5px; padding: 8px 6px;" onclick="approvePendingRoom('${room.id}')">
                    <i class="fa-solid fa-circle-check"></i> Duyệt Đăng
                </button>
                <button class="btn" style="background: #ef4444; color: white; flex: 1; justify-content: center; font-size: 12.5px; padding: 8px 6px;" onclick="rejectPendingRoom('${room.id}')">
                    <i class="fa-solid fa-circle-xmark"></i> Từ Chối
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.approvePendingRoom = async function(id) {
    if (confirm("Xác nhận duyệt phòng trọ này lên bản đồ chính?")) {
        try {
            const res = await fetch('/api/admin/pending-rooms/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });

            if (res.ok) {
                showToast("Đã duyệt đăng phòng trọ thành công!", false);
                loadPendingRooms();
            } else {
                showToast("Lỗi phê duyệt từ máy chủ!", true);
            }
        } catch (e) {
            showToast("Lỗi kết nối mạng khi gửi lệnh duyệt!", true);
        }
    }
};

window.rejectPendingRoom = async function(id) {
    if (confirm("Xác nhận từ chối và xóa vĩnh viễn tin đăng cùng toàn bộ hình ảnh phòng trọ này?")) {
        try {
            const res = await fetch('/api/admin/pending-rooms/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });

            if (res.ok) {
                showToast("Đã từ chối và xóa tin đăng thành công!", false);
                loadPendingRooms();
            } else {
                showToast("Lỗi từ chối tin từ máy chủ!", true);
            }
        } catch (e) {
            showToast("Lỗi kết nối mạng khi gửi lệnh từ chối!", true);
        }
    }
};
