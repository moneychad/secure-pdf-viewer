// ==================== 分享链接管理（仅管理员） ====================
// 动态分享链接：签名token + 时效 + 可选访问密码（复杂度强制），有效期内不限打开次数

function showShareModal(docId, docName) {
    document.getElementById('share-doc-id').value = docId;
    document.getElementById('share-doc-name').textContent = docName;
    document.getElementById('share-expires').value = '24';
    document.getElementById('share-expires-custom').value = '';
    document.getElementById('share-expires-custom').style.display = 'none';
    document.getElementById('share-password').value = '';
    document.getElementById('share-pwd-err').textContent = '';
    document.getElementById('share-create-modal').classList.remove('hidden');
}

function toggleShareExpiresCustom() {
    var sel = document.getElementById('share-expires');
    var custom = document.getElementById('share-expires-custom');
    custom.style.display = (sel.value === 'custom') ? 'block' : 'none';
}

// 与后端 _check_share_password_strength 保持一致：≥8位，含数字、大小写、特殊字符
function checkSharePwdStrength(pwd) {
    if (pwd.length < 8) return '访问密码长度不能少于 8 位';
    if (!/[0-9]/.test(pwd)) return '访问密码必须包含数字';
    if (!/[a-z]/.test(pwd)) return '访问密码必须包含小写字母';
    if (!/[A-Z]/.test(pwd)) return '访问密码必须包含大写字母';
    if (!/[^0-9a-zA-Z]/.test(pwd)) return '访问密码必须包含特殊字符';
    return null;
}

async function createShareLink() {
    var docId = document.getElementById('share-doc-id').value;
    var expiresSel = document.getElementById('share-expires').value;
    var hours;
    if (expiresSel === 'custom') {
        hours = parseInt(document.getElementById('share-expires-custom').value);
        if (isNaN(hours) || hours < 1 || hours > 720) {
            alert('自定义有效期需为 1-720 小时');
            return;
        }
    } else {
        hours = parseInt(expiresSel);
    }
    var pwd = document.getElementById('share-password').value.trim();
    var errEl = document.getElementById('share-pwd-err');
    if (pwd) {
        var pwdErr = checkSharePwdStrength(pwd);
        if (pwdErr) { errEl.textContent = pwdErr; return; }
    }
    errEl.textContent = '';

    try {
        var body = { expires_hours: hours };
        if (pwd) body.password = pwd;
        var response = await fetch(API_BASE + '/documents/' + docId + '/share-links', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        var data = await response.json();
        if (response.ok) {
            closeModal('share-create-modal');
            showShareResult(data);
        } else {
            errEl.textContent = data.detail || '创建失败';
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

function showShareResult(data) {
    var fullUrl = location.origin + data.url;
    document.getElementById('share-result-url').value = fullUrl;
    var info = '有效期至：' + formatDate(data.expires_at) + '（北京时间）<br>' +
               '访问密码：' + (data.has_password ? '已设置' : '无') + '<br>' +
               '有效期内不限打开次数，可随时在「分享管理」中吊销。';
    document.getElementById('share-result-info').innerHTML = info;
    document.getElementById('share-result-modal').classList.remove('hidden');
}

function copyShareUrl() {
    var input = document.getElementById('share-result-url');
    input.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(function() {
            alert('链接已复制');
        }, function() {
            document.execCommand('copy');
            alert('链接已复制');
        });
    } else {
        document.execCommand('copy');
        alert('链接已复制');
    }
}

function copyShareLinkByToken(token) {
    var url = location.origin + '/share.html?token=' + token;
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

var SHARE_STATUS_MAP = {
    'active':   { label: '有效',   cls: 'share-status-active' },
    'expired':  { label: '已过期', cls: 'share-status-expired' },
    'revoked':  { label: '已吊销', cls: 'share-status-revoked' }
};

async function showShareManageModal() {
    document.getElementById('share-manage-modal').classList.remove('hidden');
    await loadShareLinks();
}

async function loadShareLinks() {
    var container = document.getElementById('share-links-list');
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">加载中…</div>';
    try {
        var response = await fetch(API_BASE + '/share-links', { credentials: 'include' });
        var data = await response.json();
        if (!response.ok) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c;">' + escapeHtml(data.detail || '加载失败') + '</div>';
            return;
        }
        var links = data.links || [];
        if (links.length === 0) {
            container.innerHTML = '<div style="padding:30px;text-align:center;color:#666;">暂无分享链接</div>';
            return;
        }
        var html = '<table class="share-links-table"><thead><tr>' +
            '<th>文档</th><th>创建人</th><th>创建时间</th><th>有效期至</th>' +
            '<th>密码</th><th>打开次数</th><th>状态</th><th>操作</th>' +
            '</tr></thead><tbody>';
        links.forEach(function(link) {
            var st = SHARE_STATUS_MAP[link.status] || { label: link.status, cls: '' };
            html += '<tr>';
            html += '<td title="' + escapeHtml(link.document_name) + '">' + escapeHtml(link.document_name) + '</td>';
            html += '<td>' + escapeHtml(link.creator_name) + '</td>';
            html += '<td>' + formatDate(link.created_at) + '</td>';
            html += '<td>' + formatDate(link.expires_at) + '</td>';
            html += '<td>' + (link.has_password ? '🔑' : '-') + '</td>';
            html += '<td>' + link.view_count + '</td>';
            html += '<td><span class="share-status ' + st.cls + '">' + st.label + '</span></td>';
            html += '<td>';
            if (link.status === 'active') {
                html += '<button class="btn-sm btn-secondary" onclick="copyShareLinkByToken(\'' + link.token + '\')" title="复制链接">📋</button> ';
                html += '<button class="btn-sm btn-danger" onclick="revokeShareLink(' + link.id + ')" title="吊销">吊销</button>';
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

async function revokeShareLink(linkId) {
    if (!confirm('确定要吊销此分享链接吗？吊销后立即无法访问。')) return;
    try {
        var response = await fetch(API_BASE + '/share-links/' + linkId + '/revoke', {
            credentials: 'include',
            method: 'POST'
        });
        var data = await response.json();
        if (response.ok) {
            await loadShareLinks();
        } else {
            alert(data.detail || '吊销失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}
