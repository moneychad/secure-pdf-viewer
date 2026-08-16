/**
 * 安全文档共享平台 - 前端应用
 */

// 全局变量
let currentUser = null;
let authToken = null;
let currentDocument = null;
let currentPage = 1;
let totalPages = 0;
let pdfDoc = null;
let pageStartTime = null;
let currentFingerprintHash = null;

// API 基础地址
const API_BASE = '/api';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 收集设备指纹
        const fingerprinter = new DeviceFingerprint();
        const fingerprintData = await fingerprinter.collect();
        currentFingerprintHash = fingerprintData.fingerprint_hash;
        console.log('设备指纹已收集:', currentFingerprintHash.substring(0, 16) + '...');
    } catch (e) {
        console.error('指纹收集失败:', e);
        currentFingerprintHash = 'unknown-' + Date.now();
    }
    
    // 检查登录状态
    checkLoginStatus();
    
    // 绑定事件
    bindEvents();
});

// 事件绑定
function bindEvents() {
    // 登录表单
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        console.log('登录表单已绑定');
    }
    
    // 退出按钮
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // 导航菜单
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page) {
                showPage(page);
            }
        });
    });
    
    // PDF 翻页
    const prevPage = document.getElementById('prev-page');
    const nextPage = document.getElementById('next-page');
    if (prevPage) prevPage.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage(currentPage);
        }
    });
    if (nextPage) nextPage.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPage(currentPage);
        }
    });
    
    // 返回列表
    const backBtn = document.getElementById('back-to-list');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showPage('documents');
        });
    }
    
    // 文件上传
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    // 拖拽上传
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#e74c3c';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#3498db';
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#3498db';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                uploadFile(files[0]);
            }
        });
    }
    
    // 修改密码表单
    const changePasswordForm = document.getElementById("change-password-form");
    if (changePasswordForm) {
        changePasswordForm.addEventListener("submit", handleChangePassword);
    }
    // 创建用户表单
    const createUserForm = document.getElementById('create-user-form');
    if (createUserForm) {
        createUserForm.addEventListener('submit', handleCreateUser);
    }
}

// 登录处理
async function handleLogin(e) {
    e.preventDefault();
    console.log('开始登录...');
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        showError('login-error', '请输入用户名和密码');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        console.log('登录响应:', response.status);
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            
            // 保存到本地存储
            localStorage.setItem('token', authToken);
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            console.log('登录成功，用户:', currentUser.username);
            
            // 注册设备指纹（后台执行，不阻塞）
            registerFingerprint().catch(e => console.error('指纹注册失败:', e));
            
            // 显示主页面
            showMainPage();
        } else {
            showError('login-error', data.detail || '登录失败');
        }
    } catch (error) {
        console.error('登录错误:', error);
        showError('login-error', '网络错误，请重试');
    }
}

// 退出处理
function handleLogout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showLoginPage();
}

// 检查登录状态
function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        try {
            authToken = token;
            currentUser = JSON.parse(user);
            showMainPage();
        } catch (e) {
            showLoginPage();
        }
    } else {
        showLoginPage();
    }
}

// 显示登录页面
function showLoginPage() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
}

// 显示主页面
function showMainPage() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    document.getElementById('current-user').textContent = currentUser.username;
    
    // 根据角色显示/隐藏菜单
    const adminElements = document.querySelectorAll('.admin-only');
    if (currentUser.role === 'admin') {
        adminElements.forEach(el => el.style.display = 'block');
    } else {
        adminElements.forEach(el => el.style.display = 'none');
    }
    
    // 加载文档列表
    loadDocuments();
}

// 显示页面
function showPage(pageName) {
    // 隐藏所有页面
    document.querySelectorAll('.content-page').forEach(page => {
        page.classList.remove('active');
    });
    
    // 显示目标页面
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) {
            item.classList.add('active');
        }
    });
    
    // 加载页面数据
    switch (pageName) {
        case 'documents':
            loadDocuments();
            break;
        case 'logs':
            loadAccessLogs();
            break;
        case 'fingerprints':
            loadFingerprints();
            break;
        case 'users':
            loadUsers();
            break;
    }
}

// 加载文档列表
async function loadDocuments() {
    try {
        const response = await fetch(`${API_BASE}/documents`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderDocuments(data.documents);
        }
    } catch (error) {
        console.error('加载文档失败:', error);
    }
}

// 渲染文档列表
function renderDocuments(documents) {
    const container = document.getElementById('documents-list');
    
    if (!documents || documents.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">暂无文档，请上传 PDF 文件</p>';
        return;
    }
    
    container.innerHTML = documents.map(doc => `
        <div class="document-card">
            <h3>📄 ${escapeHtml(doc.original_name)}</h3>
            <div class="meta">
                <p>大小: ${formatFileSize(doc.file_size)}</p>
                <p>上传者: ${escapeHtml(doc.uploaded_by)}</p>
                <p>上传时间: ${formatDate(doc.uploaded_at)}</p>
            </div>
            <button class="btn-view" onclick="viewDocument(${doc.id}, '${escapeHtml(doc.original_name)}')">
                查看文档
            </button>
        </div>
    `).join('');
}

// 查看文档
async function viewDocument(docId, docName) {
    currentDocument = { id: docId, name: docName };
    currentPage = 1;
    
    document.getElementById('viewer-doc-name').textContent = docName;
    
    showPage('viewer');
    
    // 初始化 PDF.js（延迟初始化）
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    
    try {
        const response = await fetch(`${API_BASE}/documents/${docId}/view`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            if (typeof pdfjsLib !== 'undefined') {
                pdfDoc = await pdfjsLib.getDocument(url).promise;
                totalPages = pdfDoc.numPages;
                renderPage(1);
            }
            
            // 记录访问
            logAccess(docId, 'view');
        } else {
            alert('加载文档失败');
        }
    } catch (error) {
        console.error('加载文档失败:', error);
        alert('加载文档失败: ' + error.message);
    }
}

// 渲染 PDF 页面
async function renderPage(pageNum) {
    if (!pdfDoc) return;
    
    // 记录上一页停留时间
    if (pageStartTime && currentDocument) {
        const duration = Math.floor((Date.now() - pageStartTime) / 1000);
        logAccess(currentDocument.id, 'page_view', currentPage, duration);
    }
    
    const page = await pdfDoc.getPage(pageNum);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
        canvasContext: ctx,
        viewport: viewport
    }).promise;
    
    // 添加水印
    addWatermark(ctx, canvas.width, canvas.height);
    
    // 更新页码信息
    document.getElementById('viewer-page-info').textContent = `第 ${pageNum} 页 / 共 ${totalPages} 页`;
    currentPage = pageNum;
    pageStartTime = Date.now();
    
    // 记录页码访问
    logAccess(currentDocument.id, 'page_view', pageNum);
}

// 添加水印
function addWatermark(ctx, width, height) {
    const username = currentUser ? currentUser.username : 'Unknown';
    const timestamp = new Date().toLocaleString('zh-CN');
    const watermarkText = `${username} | ${timestamp}`;
    
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.font = '20px Arial';
    ctx.rotate(-20 * Math.PI / 180);
    
    // 多行水印
    for (let y = -height; y < height * 2; y += 100) {
        for (let x = -width; x < width * 2; x += 300) {
            ctx.fillText(watermarkText, x, y);
        }
    }
    
    ctx.restore();
}

// 文件选择处理
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        uploadFile(file);
    }
}

// 上传文件
async function uploadFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        showError('upload-status', '只支持 PDF 文件');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${API_BASE}/documents/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showSuccess('upload-status', '上传成功！');
            loadDocuments();
        } else {
            showError('upload-status', data.detail || '上传失败');
        }
    } catch (error) {
        showError('upload-status', '网络错误，请重试');
    }
}

// 注册设备指纹
async function registerFingerprint() {
    try {
        const fingerprinter = new DeviceFingerprint();
        const fingerprintData = await fingerprinter.collect();
        
        await fetch(`${API_BASE}/fingerprint`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(fingerprintData)
        });
    } catch (error) {
        console.error('注册指纹失败:', error);
    }
}

// 记录访问日志
async function logAccess(docId, action, pageNum = null, duration = 0) {
    try {
        await fetch(`${API_BASE}/access-log`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                document_id: docId,
                action: action,
                page_number: pageNum,
                device_fingerprint: currentFingerprintHash,
                duration_seconds: duration
            })
        });
    } catch (error) {
        console.error('记录日志失败:', error);
    }
}

// 加载访问日志
async function loadAccessLogs(page = 1) {
    try {
        const response = await fetch(`${API_BASE}/admin/logs?page=${page}&limit=50`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderLogs(data.logs, data.total, data.page, data.limit);
        }
    } catch (error) {
        console.error('加载日志失败:', error);
    }
}

// 渲染访问日志
function renderLogs(logs, total, page, limit) {
    const tbody = document.getElementById('logs-body');
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">暂无访问记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = logs.map(log => `
        <tr>
            <td>${formatDate(log.timestamp)}</td>
            <td>${escapeHtml(log.username)}</td>
            <td>${escapeHtml(log.original_name || '-')}</td>
            <td>${log.action}</td>
            <td>${log.page_number || '-'}</td>
            <td>${log.duration_seconds ? log.duration_seconds + '秒' : '-'}</td>
            <td>${log.ip_address || '-'}</td>
            <td title="${log.device_fingerprint}">${log.device_fingerprint ? log.device_fingerprint.substring(0, 8) + '...' : '-'}</td>
        </tr>
    `).join('');
    
    // 分页
    const totalPagesCount = Math.ceil(total / limit);
    const pagination = document.getElementById('logs-pagination');
    pagination.innerHTML = `
        <button onclick="loadAccessLogs(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${page} 页 / 共 ${totalPagesCount} 页</span>
        <button onclick="loadAccessLogs(${page + 1})" ${page >= totalPagesCount ? 'disabled' : ''}>下一页</button>
    `;
}

// 加载设备指纹
async function loadFingerprints() {
    try {
        const response = await fetch(`${API_BASE}/admin/fingerprints`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderFingerprints(data.fingerprints);
        }
    } catch (error) {
        console.error('加载指纹失败:', error);
    }
}

// 渲染设备指纹
function renderFingerprints(fingerprints) {
    const tbody = document.getElementById('fingerprints-body');
    
    if (!fingerprints || fingerprints.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">暂无设备记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = fingerprints.map(fp => {
        let os = 'Unknown';
        const ua = fp.user_agent || '';
        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac')) os = 'macOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iOS')) os = 'iOS';
        
        let browser = 'Unknown';
        if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';
        
        return `
            <tr>
                <td title="${fp.fingerprint_hash}">${fp.fingerprint_hash ? fp.fingerprint_hash.substring(0, 12) + '...' : '-'}</td>
                <td>${escapeHtml(fp.username)}</td>
                <td>${formatDate(fp.first_seen)}</td>
                <td>${formatDate(fp.last_seen)}</td>
                <td>${fp.ip_address || '-'}</td>
                <td>${browser}</td>
                <td>${os}</td>
            </tr>
        `;
    }).join('');
}

// 加载用户列表
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/admin/users`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderUsers(data.users);
        }
    } catch (error) {
        console.error('加载用户失败:', error);
    }
}

// 渲染用户列表
function renderUsers(users) {
    const tbody = document.getElementById('users-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">暂无用户</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${user.role}</td>
            <td>${formatDate(user.created_at)}</td>
        </tr>
    `).join('');
}

// 创建用户
async function handleCreateUser(e) {
    e.preventDefault();
    
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    
    if (!username || !password) {
        alert('请输入用户名和密码');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('用户创建成功');
            document.getElementById('new-username').value = '';
            document.getElementById('new-password').value = '';
            loadUsers();
        } else {
            alert(data.detail || '创建失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// 工具函数
function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.color = '#e74c3c';
    }
}

function showSuccess(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.color = '#27ae60';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(2)} ${units[i]}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
}


// 修改密码
async function handleChangePassword(e) {
    e.preventDefault();
    
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password-change').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!oldPassword || !newPassword || !confirmPassword) {
        alert('请填写所有字段');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alert('两次输入的新密码不一致');
        return;
    }
    
    if (newPassword.length < 6) {
        alert('新密码长度至少6位');
        return;
    }
    
    try {
        const response = await fetch(API_BASE + '/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('密码修改成功，请重新登录');
            handleLogout();
        } else {
            alert(data.detail || '修改失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}
