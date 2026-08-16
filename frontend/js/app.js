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
let currentFolderId = 1;  // 当前目录ID
let folderPath = [];  // 目录路径
let selectedDocuments = new Set();  // 选中的文档

// API 基础地址
const API_BASE = '/api';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fingerprinter = new DeviceFingerprint();
        const fingerprintData = await fingerprinter.collect();
        currentFingerprintHash = fingerprintData.fingerprint_hash;
    } catch (e) {
        currentFingerprintHash = 'unknown-' + Date.now();
    }
    
    checkLoginStatus();
    bindEvents();
});

// 事件绑定
function bindEvents() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page) showPage(page);
        });
    });
    
    const prevPage = document.getElementById('prev-page');
    const nextPage = document.getElementById('next-page');
    if (prevPage) prevPage.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderPage(currentPage); }
    });
    if (nextPage) nextPage.addEventListener('click', () => {
        if (currentPage < totalPages) { currentPage++; renderPage(currentPage); }
    });
    
    const backBtn = document.getElementById('back-to-list');
    if (backBtn) backBtn.addEventListener('click', () => showPage('documents'));
    
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#e74c3c'; });
        dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#3498db'; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#3498db';
            if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        });
    }
    
    const createUserForm = document.getElementById('create-user-form');
    if (createUserForm) createUserForm.addEventListener('submit', handleCreateUser);
    
    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) changePasswordForm.addEventListener('submit', handleChangePassword);
}

// 登录处理
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) { showError('login-error', '请输入用户名和密码'); return; }
    
    try {
        const response = await fetch(`${API_BASE}/login`, {
            credentials: 'include',
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            
            currentUser = data.user;
            
            localStorage.setItem('user', JSON.stringify(currentUser));
            registerFingerprint().catch(e => console.error('指纹注册失败:', e));
            showMainPage();
        } else {
            showError('login-error', data.detail || '登录失败');
        }
    } catch (error) {
        showError('login-error', '网络错误，请重试');
    }
}

async function handleLogout() {
    try {
        await fetch(API_BASE + "/logout", { method: "POST", credentials: "include" });
    } catch (e) { console.error("Logout error:", e); }
    
    currentUser = null;
    
    localStorage.removeItem('user');
    showLoginPage();
}

function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        try {
            authToken = token;
            currentUser = JSON.parse(user);
            showMainPage();
        } catch (e) { showLoginPage(); }
    } else { showLoginPage(); }
}

function showLoginPage() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('main-page').classList.add('hidden');
}

function showMainPage() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');
    document.getElementById('current-user').textContent = currentUser.username;
    
    const adminElements = document.querySelectorAll('.admin-only');
    if (currentUser.role === 'admin') {
        adminElements.forEach(el => el.style.display = '');
    } else {
        adminElements.forEach(el => el.style.display = 'none');
    }
    
    loadDocuments();
}

function showPage(pageName) {
    // 记录停留时间（如果正在查看文档，且要离开 viewer 页面）
    if (pageName !== 'viewer' && pageStartTime && currentDocument) {
        var duration = Math.floor((Date.now() - pageStartTime) / 1000);
        if (duration > 0) {
            // 使用同步 XHR 确保数据发送（只记录一次查看文档）
            try {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", API_BASE + "/access-log", false);
                xhr.setRequestHeader("Content-Type", "application/json");
                xhr.withCredentials = true;
                xhr.send(JSON.stringify({
                    document_id: currentDocument.id,
                    action: "view",
                    page_number: currentPage,
                    device_fingerprint: currentFingerprintHash || "unknown",
                    duration_seconds: duration
                }));
                console.log("停留时间已记录: " + duration + "秒");
            } catch (e) {
                console.error("记录停留时间失败:", e);
            }
        }
        // 重置状态
        pageStartTime = null;
        currentDocument = null;
    }
    
    document.querySelectorAll('.content-page').forEach(function(page) { page.classList.remove('active'); });
    var targetPage = document.getElementById('page-' + pageName);
    if (targetPage) targetPage.classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.page === pageName) item.classList.add('active');
    });
    
    switch (pageName) {
        case 'documents': loadDocuments(); break;
        case 'logs': loadAccessLogs(); break;
        case 'fingerprints': loadFingerprints(); break;
        case 'users': loadUsers(); break;
        case 'upload': loadFolderSelect(); break;
        case 'groups': loadGroups(); break;
        case 'permissions': loadPermissionTargets(); break;
        case 'audit-logs': loadAuditLogs(); break;
    }
}

// ==================== 文档管理 ====================

async function loadDocuments() {
    const search = document.getElementById('search-input')?.value || '';
    const sortBy = document.getElementById('sort-by')?.value || 'uploaded_at';
    const sortOrder = document.getElementById('sort-order')?.value || 'desc';
    
    try {
        // 加载当前目录的子目录
        const foldersResponse = await fetch(`${API_BASE}/folders?parent_id=${currentFolderId}`, {
            credentials: 'include',
        });
        const foldersData = await foldersResponse.json();
        
        // 加载当前目录的文档
        const docsResponse = await fetch(`${API_BASE}/documents?folder_id=${currentFolderId}&search=${search}&sort_by=${sortBy}&sort_order=${sortOrder}`, {
            credentials: 'include',
        });
        const docsData = await docsResponse.json();
        
        if (foldersResponse.ok && docsResponse.ok) {
            renderFileList(foldersData.folders, docsData.documents);
            updateBreadcrumb();
        }
    } catch (error) {
        console.error('加载文档失败:', error);
    }
}

function renderFileList(folders, documents) {
    const tbody = document.getElementById('file-body');
    selectedDocuments.clear();
    selectedFolders.clear();
    updateBatchBar();
    
    let html = '';
    
    // 渲染目录
    folders.forEach(folder => {
        html += `
            <tr class="file-row folder" data-id="${folder.id}" data-type="folder">
                <td class="col-checkbox admin-only"><input type="checkbox" class="folder-checkbox" value="${folder.id}" onchange="toggleFolderSelect(${folder.id})"></td>
                <td class="col-icon">📁</td>
                <td class="file-name" onclick="navigateToFolder(${folder.id}, '${escapeHtml(folder.name)}')">
                    ${escapeHtml(folder.name)}
                    <span class="file-count">(${folder.doc_count} 个文件)</span>
                </td>
                <td class="col-size">${formatFileSize(folder.total_size)}</td>
                <td class="col-creator">${escapeHtml(folder.creator_name || '-')}</td>
                <td class="col-time">${formatDate(folder.created_at)}</td>
                <td class="col-time">${formatDate(folder.updated_at)}</td>
                <td class="col-actions admin-only">
                    <button class="btn-action btn-edit" onclick="showRenameFolderModal(${folder.id}, '${escapeHtml(folder.name)}')" title="重命名">✏️</button>
                    <button class="btn-action btn-move" onclick="showPermissionModal('folder', ${folder.id}, '${escapeHtml(folder.name)}')" title="权限">🔐</button>
                    <button class="btn-action btn-delete" onclick="deleteFolder(${folder.id})" title="删除">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    // 渲染文档
    documents.forEach(doc => {
        html += `
            <tr class="file-row document" data-id="${doc.id}" data-type="document">
                <td class="col-checkbox admin-only">
                    <input type="checkbox" class="doc-checkbox" value="${doc.id}" onchange="toggleDocumentSelect(${doc.id})">
                </td>
                <td class="col-icon">📄</td>
                <td class="file-name" onclick="viewDocument(${doc.id}, '${escapeHtml(doc.original_name)}')">
                    ${escapeHtml(doc.original_name)}
                </td>
                <td class="col-size">${formatFileSize(doc.file_size)}</td>
                <td class="col-creator">${escapeHtml(doc.uploader_name || '-')}</td>
                <td class="col-time">${formatDate(doc.uploaded_at)}</td>
                <td class="col-time">${formatDate(doc.updated_at)}</td>
                <td class="col-actions admin-only">
                    <button class="btn-action btn-move" onclick="showMoveDocModal(${doc.id})" title="移动">📁</button>
                    <button class="btn-action btn-move" onclick="showPermissionModal('document', ${doc.id}, '${escapeHtml(doc.original_name)}')" title="权限">🔐</button>
                    <button class="btn-action btn-delete" onclick="deleteDocument(${doc.id})" title="删除">🗑️</button>
                </td>
            </tr>
        `;
    });
    
    if (!folders.length && !documents.length) {
        html = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#666;">此目录为空</td></tr>';
    }
    
    tbody.innerHTML = html;
}

function navigateToFolder(folderId, folderName) {
    currentFolderId = folderId;
    folderPath.push({ id: folderId, name: folderName });
    loadDocuments();
}

function navigateToPath(index) {
    if (index < 0) {
        currentFolderId = 1;
        folderPath = [];
    } else {
        folderPath = folderPath.slice(0, index + 1);
        currentFolderId = folderPath[index].id;
    }
    loadDocuments();
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    let html = '<a href="#" onclick="navigateToPath(-1); return false;">根目录</a>';
    
    folderPath.forEach((folder, index) => {
        html += ` <span>/</span> `;
        if (index === folderPath.length - 1) {
            html += `<strong>${escapeHtml(folder.name)}</strong>`;
        } else {
            html += `<a href="#" onclick="navigateToPath(${index}); return false;">${escapeHtml(folder.name)}</a>`;
        }
    });
    
    breadcrumb.innerHTML = html;
}

function handleSearch(event) {
    if (event.key === 'Enter') {
        loadDocuments();
    }
}

// ==================== 目录操作 ====================

function showCreateFolderModal() {
    document.getElementById('new-folder-name').value = '';
    document.getElementById('create-folder-modal').classList.remove('hidden');
}

function showRenameFolderModal(folderId, currentName) {
    document.getElementById('rename-folder-id').value = folderId;
    document.getElementById('rename-folder-name').value = currentName;
    document.getElementById('rename-folder-modal').classList.remove('hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

async function createFolder() {
    const name = document.getElementById('new-folder-name').value.trim();
    if (!name) { alert('请输入目录名称'); return; }
    
    try {
        const response = await fetch(`${API_BASE}/folders`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, parent_id: currentFolderId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeModal('create-folder-modal');
            loadDocuments();
        } else {
            alert(data.detail || '创建失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function renameFolder() {
    const folderId = document.getElementById('rename-folder-id').value;
    const name = document.getElementById('rename-folder-name').value.trim();
    if (!name) { alert('请输入新名称'); return; }
    
    try {
        const response = await fetch(`${API_BASE}/folders/${folderId}`, {
            credentials: 'include',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeModal('rename-folder-modal');
            loadDocuments();
        } else {
            alert(data.detail || '重命名失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function deleteFolder(folderId) {
    if (!confirm('确定要删除此目录吗？目录下的文件将被移到根目录。')) return;
    
    try {
        const response = await fetch(`${API_BASE}/folders/${folderId}`, {
            credentials: 'include',
            method: 'DELETE',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            loadDocuments();
        } else {
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// ==================== 文档操作 ====================

function toggleDocumentSelect(docId) {
    if (selectedDocuments.has(docId)) {
        selectedDocuments.delete(docId);
    } else {
        selectedDocuments.add(docId);
    }
    updateBatchBar();
}

function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.doc-checkbox, .folder-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
        const id = parseInt(cb.value);
        if (cb.classList.contains('folder-checkbox')) {
            if (!allChecked) {
                selectedFolders.add(id);
            } else {
                selectedFolders.delete(id);
            }
        } else {
            if (!allChecked) {
                selectedDocuments.add(id);
            } else {
                selectedDocuments.delete(id);
            }
        }
    });
    
    updateBatchBar();
}

function updateBatchBar() {
    const batchBar = document.getElementById('batch-bar');
    const count = selectedDocuments.size;
    
    if (count > 0) {
        batchBar.style.display = 'flex';
        document.getElementById('selected-count').textContent = `已选 ${count} 项`;
    } else {
        batchBar.style.display = 'none';
    }
}

async function deleteDocument(docId) {
    if (!confirm('确定要删除此文档吗？')) return;
    
    try {
        const response = await fetch(`${API_BASE}/documents/${docId}`, {
            credentials: 'include',
            method: 'DELETE',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            loadDocuments();
        } else {
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function batchDelete() {
    if (!confirm(`确定要删除选中的 ${selectedDocuments.size} 个文档吗？`)) return;
    
    try {
        const response = await fetch(`${API_BASE}/documents/batch-delete`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ document_ids: Array.from(selectedDocuments) })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            selectedDocuments.clear();
            loadDocuments();
        } else {
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

function showMoveDocModal(docId) {
    document.getElementById('move-doc-id').value = docId;
    loadFolderOptions('move-folder-select');
    document.getElementById('move-doc-modal').classList.remove('hidden');
}

function showBatchMoveModal() {
    loadFolderOptions('batch-move-folder-select');
    document.getElementById('batch-move-modal').classList.remove('hidden');
}

async function moveDocument() {
    const docId = document.getElementById('move-doc-id').value;
    const folderId = document.getElementById('move-folder-select').value;
    
    try {
        const response = await fetch(`${API_BASE}/documents/${docId}/move`, {
            credentials: 'include',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ folder_id: parseInt(folderId) })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeModal('move-doc-modal');
            loadDocuments();
        } else {
            alert(data.detail || '移动失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function batchMove() {
    const folderId = document.getElementById('batch-move-folder-select').value;
    
    try {
        const response = await fetch(`${API_BASE}/documents/batch-move`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                document_ids: Array.from(selectedDocuments),
                folder_id: parseInt(folderId)
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeModal('batch-move-modal');
            selectedDocuments.clear();
            loadDocuments();
        } else {
            alert(data.detail || '移动失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function loadFolderOptions(selectId) {
    try {
        const response = await fetch(`${API_BASE}/folders`, {
            credentials: 'include',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const select = document.getElementById(selectId);
            select.innerHTML = '<option value="1">根目录</option>';
            data.folders.forEach(folder => {
                select.innerHTML += `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`;
            });
        }
    } catch (error) {
        console.error('加载目录失败:', error);
    }
}

async function loadFolderSelect() {
    await loadFolderOptions('upload-folder-select');
}

// ==================== 文件上传 ====================

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        uploadFiles(e.target.files);
    }
}

async function uploadFiles(files) {
    const folderId = document.getElementById('upload-folder-select')?.value || currentFolderId;
    const statusEl = document.getElementById('upload-status');
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            failCount++;
            continue;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch(`${API_BASE}/documents/upload?folder_id=${folderId}`, {
                credentials: 'include',
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }
    
    let message = `上传完成：${successCount} 个成功`;
    if (failCount > 0) message += `，${failCount} 个失败`;
    
    statusEl.innerHTML = `<span style="color:${failCount > 0 ? '#e74c3c' : '#27ae60'}">${message}</span>`;
    
    if (successCount > 0) {
        loadDocuments();
    }
}

// ==================== 文档查看 ====================

async function viewDocument(docId, docName) {
    // 如果之前在查看文档，先记录停留时间
    if (pageStartTime && currentDocument) {
        var prevDuration = Math.floor((Date.now() - pageStartTime) / 1000);
        if (prevDuration > 0) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open("POST", API_BASE + "/access-log", false);
                xhr.setRequestHeader("Content-Type", "application/json");
                xhr.withCredentials = true;
                xhr.send(JSON.stringify({
                    document_id: currentDocument.id,
                    action: "view",
                    page_number: currentPage,
                    device_fingerprint: currentFingerprintHash || "unknown",
                    duration_seconds: prevDuration
                }));
            } catch (e) {
                console.error("记录停留时间失败:", e);
            }
        }
    }
    
    currentDocument = { id: docId, name: docName };
    currentPage = 1;
    pageStartTime = Date.now();  // 设置开始时间
    
    document.getElementById('viewer-doc-name').textContent = docName;
    showPage('viewer');
    
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    
    try {
        const response = await fetch(`${API_BASE}/documents/${docId}/view`, {
            credentials: 'include',
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            if (typeof pdfjsLib !== 'undefined') {
                pdfDoc = await pdfjsLib.getDocument(url).promise;
                totalPages = pdfDoc.numPages;
                renderPage(1);
            }
            
            // 记录查看（只记录一次，不在这里记录，由 showPage 记录）
        } else {
            alert('加载文档失败');
        }
    } catch (error) {
        alert('加载文档失败: ' + error.message);
    }
}

async function renderPage(pageNum) {
    if (!pdfDoc) return;
    
    if (pageStartTime && currentDocument) {
        const duration = Math.floor((Date.now() - pageStartTime) / 1000);
        logAccess(currentDocument.id, 'page_view', currentPage, duration);
    }
    
    const page = await pdfDoc.getPage(pageNum);
    
    // 获取容器宽度，自适应缩放
    const container = document.querySelector('.pdf-viewer-wrapper');
    const containerWidth = container ? container.clientWidth - 40 : 800;  // 减去边距
    
    // 获取原始页面尺寸
    const originalViewport = page.getViewport({ scale: 1 });
    
    // 计算自适应缩放比例（限制在 0.5 到 2.0 之间）
    let scale = Math.min(containerWidth / originalViewport.width, 2.0);
    scale = Math.max(scale, 0.5);
    
    const viewport = page.getViewport({ scale });
    
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    
    // 高清显示
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = viewport.width * pixelRatio;
    canvas.height = viewport.height * pixelRatio;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    addWatermark(ctx, viewport.width, viewport.height);
    
    document.getElementById('viewer-page-info').textContent = `第 ${pageNum} 页 / 共 ${totalPages} 页`;
    
    // 只在翻页时记录（不是初始加载）
    if (currentPage !== pageNum) {
        logAccess(currentDocument.id, 'page_view', pageNum);
    }
    
    currentPage = pageNum;
    pageStartTime = Date.now();
}

function addWatermark(ctx, width, height) {
    const username = currentUser ? currentUser.username : 'Unknown';
    const timestamp = new Date().toLocaleString('zh-CN');
    const watermarkText = `${username} | ${timestamp}`;
    
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.font = '20px Arial';
    ctx.rotate(-20 * Math.PI / 180);
    
    for (let y = -height; y < height * 2; y += 100) {
        for (let x = -width; x < width * 2; x += 300) {
            ctx.fillText(watermarkText, x, y);
        }
    }
    
    ctx.restore();
}

// ==================== 其他功能 ====================

async function registerFingerprint() {
    try {
        const fingerprinter = new DeviceFingerprint();
        const fingerprintData = await fingerprinter.collect();
        
        await fetch(`${API_BASE}/fingerprint`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(fingerprintData)
        });
    } catch (error) {
        console.error('注册指纹失败:', error);
    }
}

async function logAccess(docId, action, pageNum = null, duration = 0) {
    try {
        await fetch(`${API_BASE}/access-log`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
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

async function loadAccessLogs(page = 1) {
    try {
        const response = await fetch(`${API_BASE}/admin/logs?page=${page}&limit=50`, {
            credentials: 'include',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderLogs(data.logs, data.total, data.page, data.limit);
        }
    } catch (error) {
        console.error('加载日志失败:', error);
    }
}

function renderLogs(logs, total, page, limit) {
    const tbody = document.getElementById('logs-body');
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">暂无访问记录</td></tr>';
        return;
    }
    
    // 操作类型映射
    const actionMap = {
        "view": "查看文档",
        "page_view": "翻页"
    };
    
    tbody.innerHTML = logs.map(log => `
        <tr>
            <td>${formatDate(log.timestamp)}</td>
            <td>${escapeHtml(log.username)}</td>
            <td>${escapeHtml(log.original_name || '-')}</td>
            <td>${actionMap[log.action] || log.action}</td>
            <td>${log.page_number || '-'}</td>
            <td>${log.duration_seconds > 0 ? log.duration_seconds + '秒' : '-'}</td>
            <td>${escapeHtml(log.ip_address || '-')}</td>
            <td title="${log.device_fingerprint}">${log.device_fingerprint ? log.device_fingerprint.substring(0, 8) + '...' : '-'}</td>
        </tr>
    `).join('');
    
    const totalPagesCount = Math.ceil(total / limit);
    const pagination = document.getElementById('logs-pagination');
    pagination.innerHTML = `
        <button onclick="loadAccessLogs(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${page} 页 / 共 ${totalPagesCount} 页</span>
        <button onclick="loadAccessLogs(${page + 1})" ${page >= totalPagesCount ? 'disabled' : ''}>下一页</button>
    `;
}

async function loadFingerprints() {
    try {
        const response = await fetch(`${API_BASE}/admin/fingerprints`, {
            credentials: 'include',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderFingerprints(data.fingerprints);
        }
    } catch (error) {
        console.error('加载指纹失败:', error);
    }
}

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

// ==================== 用户管理 ====================

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/admin/users`, {
            credentials: 'include',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderUsers(data.users);
        }
    } catch (error) {
        console.error('加载用户失败:', error);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">暂无用户</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${user.role === 'admin' ? '管理员' : '普通用户'}</td>
            <td>${user.is_active ? '<span style="color:green">启用</span>' : '<span style="color:red">停用</span>'}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>${formatDate(user.updated_at)}</td>
            <td>${formatDate(user.last_login)}</td>
            <td>
                <button class="btn-action btn-edit" onclick="editUser(${user.id})" title="编辑">✏️</button>
                <button class="btn-action btn-toggle" onclick="toggleUser(${user.id}, ${user.is_active})" title="${user.is_active ? '停用' : '启用'}">
                    ${user.is_active ? '🚫' : '✅'}
                </button>
                <button class="btn-action btn-reset" onclick="resetPassword(${user.id})" title="重置密码">🔑</button>
                ${user.username !== currentUser.username ? 
                    `<button class="btn-action btn-delete" onclick="deleteUser(${user.id})" title="删除">🗑️</button>` : 
                    ''
                }
            </td>
        </tr>
    `).join('');
}

async function handleCreateUser(e) {
    e.preventDefault();
    
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    
    if (!username || !password) { alert('请输入用户名和密码'); return; }
    
    try {
        const response = await fetch(`${API_BASE}/register`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password, role })
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

async function editUser(userId) {
    const newRole = prompt('请输入新角色 (admin/viewer):');
    if (!newRole || !['admin', 'viewer'].includes(newRole)) {
        if (newRole !== null) alert('角色只能是 admin 或 viewer');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
            credentials: 'include',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: newRole })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('用户更新成功');
            loadUsers();
        } else {
            alert(data.detail || '更新失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function toggleUser(userId, currentStatus) {
    const action = currentStatus ? '停用' : '启用';
    if (!confirm(`确定要${action}该用户吗？`)) return;
    
    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
            credentials: 'include',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ is_active: !currentStatus })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`用户已${action}`);
            loadUsers();
        } else {
            alert(data.detail || '操作失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function resetPassword(userId) {
    const newPassword = prompt('请输入新密码（至少6位）:');
    if (!newPassword) return;
    
    if (newPassword.length < 6) {
        alert('密码长度至少6位');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
            credentials: 'include',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password: newPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('密码重置成功');
        } else {
            alert(data.detail || '重置失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function deleteUser(userId) {
    if (!confirm('确定要删除该用户吗？此操作不可恢复！')) return;
    
    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
            credentials: 'include',
            method: 'DELETE',
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('用户已删除');
            loadUsers();
        } else {
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// ==================== 修改密码 ====================

async function handleChangePassword(e) {
    e.preventDefault();
    
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password-change').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!oldPassword || !newPassword || !confirmPassword) { alert('请填写所有字段'); return; }
    if (newPassword !== confirmPassword) { alert('两次输入的新密码不一致'); return; }
    if (newPassword.length < 6) { alert('新密码长度至少6位'); return; }
    
    try {
        const response = await fetch(`${API_BASE}/change-password`, {
            credentials: 'include',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
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

// ==================== 工具函数 ====================

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


// ==================== 弹窗上传功能 ====================

function showUploadModal() {
    // 更新目标目录信息
    const folderName = getCurrentFolderName();
    document.getElementById('upload-target-info').textContent = '目标目录：' + folderName;
    document.getElementById('modal-upload-status').innerHTML = '';
    document.getElementById('upload-modal').classList.remove('hidden');
    
    // 绑定事件
    const fileInput = document.getElementById('modal-file-input');
    fileInput.onchange = function() {
        if (this.files.length > 0) {
            modalUploadFiles(this.files);
        }
    };
    
    const dropZone = document.getElementById('modal-drop-zone');
    dropZone.ondragover = function(e) {
        e.preventDefault();
        this.style.borderColor = '#e74c3c';
    };
    dropZone.ondragleave = function() {
        this.style.borderColor = '#3498db';
    };
    dropZone.ondrop = function(e) {
        e.preventDefault();
        this.style.borderColor = '#3498db';
        if (e.dataTransfer.files.length > 0) {
            modalUploadFiles(e.dataTransfer.files);
        }
    };
}

function getCurrentFolderName() {
    if (folderPath.length === 0) {
        return '根目录';
    }
    return folderPath[folderPath.length - 1].name;
}

async function modalUploadFiles(files) {
    const statusEl = document.getElementById('modal-upload-status');
    let successCount = 0;
    let failCount = 0;
    
    statusEl.innerHTML = '<span style=color:#3498db>上传中...</span>';
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            failCount++;
            continue;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch(API_BASE + '/documents/upload?folder_id=' + currentFolderId, {
                credentials: 'include',
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }
    
    let message = '上传完成：' + successCount + ' 个成功';
    if (failCount > 0) message += '，' + failCount + ' 个失败';
    
    statusEl.innerHTML = '<span style=color: + (failCount > 0 ? #e74c3c : #27ae60) + >' + message + '</span>';
    
    if (successCount > 0) {
        loadDocuments();
    }
    
    // 清空文件输入
    document.getElementById('modal-file-input').value = '';
}




// ==================== XSS 防护工具 ====================

// 安全的 DOM 操作方法
function createElementSafe(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;  // textContent 自动转义，防 XSS
    return el;
}

// 清空容器并添加子元素
function setChildrenSafe(container, children) {
    container.innerHTML = "";  // 先清空
    children.forEach(child => container.appendChild(child));
}

// 创建选项元素
function createOptionSafe(value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
}

// 修改 loadFolderOptions 函数，使用 DOM 方法
const _originalLoadFolderOptions = loadFolderOptions;
loadFolderOptions = async function(selectId) {
    try {
        const response = await fetch(API_BASE + "/folders", {
            credentials: "include"
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const select = document.getElementById(selectId);
            // 清空现有选项
            select.innerHTML = "";
            
            // 添加根目录选项
            const rootOption = document.createElement("option");
            rootOption.value = "1";
            rootOption.textContent = "根目录";
            select.appendChild(rootOption);
            
            // 添加其他目录选项
            data.folders.forEach(folder => {
                const option = document.createElement("option");
                option.value = folder.id;
                option.textContent = folder.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error("加载目录失败:", error);
    }
};


// ==================== 审计日志 ====================

async function loadAuditLogs(page = 1) {
    try {
        const response = await fetch(`${API_BASE}/admin/audit-logs?page=${page}&limit=50`, {
            credentials: "include"
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderAuditLogs(data.logs, data.total, data.page, data.limit);
        }
    } catch (error) {
        console.error("加载审计日志失败:", error);
    }
}

function renderAuditLogs(logs, total, page, limit) {
    const tbody = document.getElementById("audit-logs-body");
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = "<tr><td colspan=\"7\" style=\"text-align:center;\">暂无审计日志</td></tr>";
        return;
    }
    
    tbody.innerHTML = logs.map(log => `
        <tr>
            <td>${formatDate(log.timestamp)}</td>
            <td>${escapeHtml(log.username)}</td>
            <td><span class="audit-action">${escapeHtml(log.action)}</span></td>
            <td>${escapeHtml(log.target_type || "-")}</td>
            <td>${escapeHtml(log.target_name || log.target_id || "-")}</td>
            <td>${escapeHtml(log.details || "-")}</td>
            <td>${escapeHtml(log.ip_address || "-")}</td>
        </tr>
    `).join("");
    
    const totalPages = Math.ceil(total / limit);
    const pagination = document.getElementById("audit-logs-pagination");
    pagination.innerHTML = `
        <button onclick="loadAuditLogs(${page - 1})" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <span>第 ${page} 页 / 共 ${totalPages} 页</span>
        <button onclick="loadAuditLogs(${page + 1})" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    `;
}

// ==================== 页面离开事件 ====================

// 记录最后一页的停留时间
window.addEventListener("beforeunload", function() {
    if (pageStartTime && currentDocument) {
        const duration = Math.floor((Date.now() - pageStartTime) / 1000);
        if (duration > 0) {
            // 使用 sendBeacon 确保数据发送
            const data = JSON.stringify({
                document_id: currentDocument.id,
                action: "page_view",
                page_number: currentPage,
                device_fingerprint: currentFingerprintHash || "unknown",
                duration_seconds: duration
            });
            navigator.sendBeacon(API_BASE + "/access-log", data);
        }
    }
});
// ==================== 目录选中和权限功能 ====================

var selectedFolders = new Set();

function toggleFolderSelect(folderId) {
    if (selectedFolders.has(folderId)) {
        selectedFolders.delete(folderId);
    } else {
        selectedFolders.add(folderId);
    }
    updateBatchBar();
}

function updateBatchBar() {
    var batchBar = document.getElementById('batch-bar');
    var totalCount = selectedDocuments.size + selectedFolders.size;
    
    if (totalCount > 0) {
        batchBar.style.display = 'flex';
        document.getElementById('selected-count').textContent = '已选 ' + totalCount + ' 项';
    } else {
        batchBar.style.display = 'none';
    }
}

function showPermissionModal(resourceType, resourceId, resourceName) {
    document.getElementById('permission-modal-title').textContent = '配置权限: ' + resourceName;
    document.getElementById('perm-resource-type').value = resourceType;
    document.getElementById('perm-resource-id').value = resourceId;
    document.getElementById('perm-search-input').value = '';
    document.getElementById('perm-selected-target').style.display = 'none';
    document.getElementById('permission-modal').classList.remove('hidden');
    loadAllPermTargets('perm-search-results', 'selectPermTarget');
}

function showBatchPermissionModal() {
    var count = selectedDocuments.size + selectedFolders.size;
    if (count === 0) {
        alert('请先选择文件或目录');
        return;
    }
    document.getElementById('batch-perm-count').textContent = '已选 ' + count + ' 个项目';
    document.getElementById('batch-perm-search').value = '';
    document.getElementById('batch-perm-selected').style.display = 'none';
    document.getElementById('batch-permission-modal').classList.remove('hidden');
    loadAllPermTargets('batch-perm-results', 'selectBatchPermTarget');
}

function loadAllPermTargets(containerId, selectFn) {
    fetch(API_BASE + '/search/users-and-groups?q=', {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        renderPermResults(data.results || [], containerId, selectFn);
    });
}

function renderPermResults(results, containerId, selectFn) {
    var html = '';
    results.forEach(function(item) {
        var typeLabel = item.type === 'user' ? '用户' : '用户组';
        var typeClass = item.type === 'user' ? '' : 'group';
        html += '<div class="search-result-item" onclick="' + selectFn + '(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name).replace(/'/g, "\\'") + '\')">';
        html += '<span class="search-result-type ' + typeClass + '">' + typeLabel + '</span>';
        html += '<span>' + escapeHtml(item.name) + '</span>';
        html += '</div>';
    });
    if (results.length === 0) {
        html = '<div class="search-result-item"><span style="color:#999;">未找到匹配项</span></div>';
    }
    document.getElementById(containerId).innerHTML = html;
}

function searchPermTargets() {
    var query = document.getElementById('perm-search-input').value.trim();
    if (query.length < 1) {
        loadAllPermTargets('perm-search-results', 'selectPermTarget');
        return;
    }
    
    fetch(API_BASE + '/search/users-and-groups?q=' + encodeURIComponent(query), {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        renderPermResults(data.results || [], 'perm-search-results', 'selectPermTarget');
    });
}

var permTargetType = null;
var permTargetId = null;

function selectPermTarget(type, id, name) {
    permTargetType = type;
    permTargetId = id;
    var typeLabel = type === 'user' ? '用户' : '用户组';
    document.getElementById('perm-target-display').textContent = typeLabel + ': ' + name;
    document.getElementById('perm-selected-target').style.display = 'block';
    document.getElementById('perm-search-results').innerHTML = '';
    document.getElementById('perm-search-input').value = '';
}

function clearPermTarget() {
    permTargetType = null;
    permTargetId = null;
    document.getElementById('perm-selected-target').style.display = 'none';
}

function savePermission() {
    if (!permTargetType || !permTargetId) {
        alert('请选择用户或用户组');
        return;
    }
    
    var resourceType = document.getElementById('perm-resource-type').value;
    var resourceId = parseInt(document.getElementById('perm-resource-id').value);
    
    fetch(API_BASE + '/permissions', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target_type: permTargetType,
            target_id: permTargetId,
            resource_type: resourceType,
            resource_id: resourceId,
            can_read: true
        })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.message) {
            alert('权限配置成功');
            closeModal('permission-modal');
        } else {
            alert(data.detail || '配置失败');
        }
    });
}

// 批量权限
function showBatchPermissionModal() {
    var count = selectedDocuments.size + selectedFolders.size;
    if (count === 0) {
        alert('请先选择文件或目录');
        return;
    }
    document.getElementById('batch-perm-count').textContent = '已选 ' + count + ' 个项目';
    document.getElementById('batch-perm-search').value = '';
    document.getElementById('batch-perm-results').innerHTML = '';
    document.getElementById('batch-perm-selected').style.display = 'none';
    document.getElementById('batch-permission-modal').classList.remove('hidden');
}

function searchBatchPermTargets() {
    var query = document.getElementById('batch-perm-search').value.trim();
    if (query.length < 1) {
        document.getElementById('batch-perm-results').innerHTML = '';
        return;
    }
    
    fetch(API_BASE + '/search/users-and-groups?q=' + encodeURIComponent(query), {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        var results = data.results || [];
        var html = '';
        
        results.forEach(function(item) {
            var typeLabel = item.type === 'user' ? '用户' : '用户组';
            var typeClass = item.type === 'user' ? '' : 'group';
            html += '<div class="search-result-item" onclick="selectBatchPermTarget(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name).replace(/'/g, "\\'") + '\')">';
            html += '<span class="search-result-type ' + typeClass + '">' + typeLabel + '</span>';
            html += '<span>' + escapeHtml(item.name) + '</span>';
            html += '</div>';
        });
        
        if (results.length === 0) {
            html = '<div class="search-result-item"><span style="color:#999;">未找到匹配项</span></div>';
        }
        
        document.getElementById('batch-perm-results').innerHTML = html;
    });
}

var batchPermTargetType = null;
var batchPermTargetId = null;

function selectBatchPermTarget(type, id, name) {
    batchPermTargetType = type;
    batchPermTargetId = id;
    var typeLabel = type === 'user' ? '用户' : '用户组';
    document.getElementById('batch-perm-display').textContent = typeLabel + ': ' + name;
    document.getElementById('batch-perm-selected').style.display = 'block';
    document.getElementById('batch-perm-results').innerHTML = '';
    document.getElementById('batch-perm-search').value = '';
}

function clearBatchPermTarget() {
    batchPermTargetType = null;
    batchPermTargetId = null;
    document.getElementById('batch-perm-selected').style.display = 'none';
}

function saveBatchPermissions() {
    if (!batchPermTargetType || !batchPermTargetId) {
        alert('请选择用户或用户组');
        return;
    }
    
    var items = [];
    selectedDocuments.forEach(function(docId) {
        items.push({ resource_type: 'document', resource_id: docId, can_read: true });
    });
    selectedFolders.forEach(function(folderId) {
        items.push({ resource_type: 'folder', resource_id: folderId, can_read: true });
    });
    
    if (items.length === 0) {
        alert('请先选择文件或目录');
        return;
    }
    
    fetch(API_BASE + '/permissions/batch', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target_type: batchPermTargetType,
            target_id: batchPermTargetId,
            items: items
        })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.message) {
            alert(data.message);
            closeModal('batch-permission-modal');
            loadDocuments();
        } else {
            alert(data.detail || '配置失败');
        }
    });
}
