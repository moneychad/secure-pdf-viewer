// ==================== 平台登录链接管理（仅管理员） ====================
// 免密动态登录：签名token + 时效 + 可吊销；访客以指定账号身份登录，会话有效期跟随链接

function showLoginLinkModal(userId, username) {
    document.getElementById('login-link-user-id').value = userId;
    document.getElementById('login-link-username').textContent = username;
    document.getElementById('login-link-expires').value = '24';
    document.getElementById('login-link-result').style.display = 'none';
    document.getElementById('login-link-url').value = '';
    document.getElementById('login-link-gen-btn').style.display = '';
    document.getElementById('login-link-create-modal').classList.remove('hidden');
}

async function createLoginLink() {
    var userId = document.getElementById('login-link-user-id').value;
    var hours = parseInt(document.getElementById('login-link-expires').value);
    try {
        var response = await fetch(API_BASE + '/users/' + userId + '/login-links', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expires_hours: hours })
        });
        var data = await response.json();
        if (response.ok) {
            document.getElementById('login-link-url').value = location.origin + data.url;
            document.getElementById('login-link-info').innerHTML =
                '有效期至：' + formatDate(data.expires_at) + '（北京时间）<br>' +
                '有效期内不限使用次数；可随时在「登录链接管理」中吊销，吊销后立即无法登录。';
            document.getElementById('login-link-result').style.display = 'block';
            document.getElementById('login-link-gen-btn').style.display = 'none';
        } else {
            alert(data.detail || '生成失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

function copyLoginLinkUrl() {
    var input = document.getElementById('login-link-url');
    input.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(function() { alert('链接已复制'); }, function() {
            document.execCommand('copy'); alert('链接已复制');
        });
    } else {
        document.execCommand('copy');
        alert('链接已复制');
    }
}

function copyLoginLinkByToken(token) {
    var url = location.origin + '/login.html?token=' + token;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() { alert('链接已复制'); });
    } else {
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('链接已复制');
    }
}

async function showLoginLinkManageModal() {
    document.getElementById('login-link-manage-modal').classList.remove('hidden');
    await loadLoginLinks();
}

async function loadLoginLinks() {
    var container = document.getElementById('login-links-list');
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">加载中…</div>';
    try {
        var response = await fetch(API_BASE + '/login-links', { credentials: 'include' });
        var data = await response.json();
        if (!response.ok) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c;">' + escapeHtml(data.detail || '加载失败') + '</div>';
            return;
        }
        var links = data.links || [];
        if (links.length === 0) {
            container.innerHTML = '<div style="padding:30px;text-align:center;color:#666;">暂无登录链接</div>';
            return;
        }
        var html = '<table class="share-links-table"><thead><tr>' +
            '<th>目标账号</th><th>创建人</th><th>创建时间</th><th>有效期至</th>' +
            '<th>使用次数</th><th>最近使用</th><th>状态</th><th>操作</th>' +
            '</tr></thead><tbody>';
        links.forEach(function(link) {
            var st = SHARE_STATUS_MAP[link.status] || { label: link.status, cls: '' };
            html += '<tr>';
            html += '<td>' + escapeHtml(link.target_username) + '</td>';
            html += '<td>' + escapeHtml(link.creator_name) + '</td>';
            html += '<td>' + formatDate(link.created_at) + '</td>';
            html += '<td>' + formatDate(link.expires_at) + '</td>';
            html += '<td>' + link.use_count + '</td>';
            html += '<td>' + (link.last_used_at ? formatDate(link.last_used_at) : '-') + '</td>';
            html += '<td><span class="share-status ' + st.cls + '">' + st.label + '</span></td>';
            html += '<td>';
            if (link.status === 'active') {
                html += '<button class="btn-sm btn-secondary" onclick="copyLoginLinkByToken(\'' + link.token + '\')" title="复制链接">📋</button> ';
                html += '<button class="btn-sm btn-danger" onclick="revokeLoginLink(' + link.id + ')" title="吊销">吊销</button>';
            } else {
                html += '<span style="color:#999;font-size:12px;">—</span>';
            }
            html += '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c;">网络错误</div>';
    }
}

async function revokeLoginLink(linkId) {
    if (!confirm('确定要吊销此登录链接吗？吊销后立即无法通过该链接登录。')) return;
    try {
        var response = await fetch(API_BASE + '/login-links/' + linkId + '/revoke', {
            credentials: 'include',
            method: 'POST'
        });
        var data = await response.json();
        if (response.ok) {
            await loadLoginLinks();
        } else {
            alert(data.detail || '吊销失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}
