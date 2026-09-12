// ==================== 平台登录链接管理（仅管理员） ====================
// 免密动态登录：签名token + 时效 + 可吊销；访客以指定账号身份登录，会话有效期跟随链接

function showLoginLinkModal(userId, username) {
    document.getElementById('login-link-user-id').value = userId;
    document.getElementById('login-link-username').textContent = username;
    document.getElementById('login-link-expires').value = '24';
    document.getElementById('login-link-expires-custom').value = '';
    document.getElementById('login-link-expires-custom-row').style.display = 'none';
    document.getElementById('login-link-result').style.display = 'none';
    document.getElementById('login-link-url').value = '';
    document.getElementById('login-link-gen-btn').style.display = '';
    document.getElementById('login-link-create-modal').classList.remove('hidden');
}

function toggleLoginLinkExpiresCustom() {
    var sel = document.getElementById('login-link-expires');
    var row = document.getElementById('login-link-expires-custom-row');
    row.style.display = (sel.value === 'other') ? 'flex' : 'none';
}

async function createLoginLink() {
    var userId = document.getElementById('login-link-user-id').value;
    var expiresSel = document.getElementById('login-link-expires').value;
    var hours;
    if (expiresSel === 'other') {
        var daysRaw = document.getElementById('login-link-expires-custom').value.trim();
        var days = Number(daysRaw);
        if (!daysRaw || !Number.isInteger(days) || days < 1 || days > 30) {
            alert('请输入 1 ~ 30 之间的整数天数');
            return;
        }
        hours = days * 24;
    } else {
        hours = parseInt(expiresSel);
    }
    try {
        var response = await fetch(API_BASE + '/users/' + userId + '/login-links', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expires_hours: hours })
        });
        var data = await response.json();
        if (response.ok) {
            document.getElementById('login-link-url').value = fullLinkUrl(data.url);
            document.getElementById('login-link-info').innerHTML =
                '有效期至：' + formatDate(data.expires_at) + '（北京时间）<br>' +
                '访客打开链接后<strong>仍需输入该账号的用户名和密码</strong>才能登录；<br>' +
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

function copyLoginLink(url) {
    var fullUrl = fullLinkUrl(url);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullUrl).then(function() { alert('链接已复制'); });
    } else {
        var ta = document.createElement('textarea');
        ta.value = fullUrl;
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
                html += '<button class="btn-sm btn-secondary" onclick="copyLoginLink(\'' + link.url + '\')" title="复制链接">📋</button> ';
                html += '<button class="btn-sm btn-danger" onclick="revokeLoginLink(' + link.id + ')" title="吊销">吊销</button>';
            } else {
                html += '<span style="color:#999;font-size:12px;">—</span>';
            }
            html += '<button class="btn-sm btn-secondary" onclick="showLinkDevicesModal(' + link.id + ', \'' + escapeHtml(link.target_username) + '\')" title="设备管理" style="margin-left:4px;">📱</button>';
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

// ==================== 登录链接设备管理 ====================
var currentDevicesLinkId = null;

async function showLinkDevicesModal(linkId, username) {
    currentDevicesLinkId = linkId;
    document.getElementById('login-link-devices-modal').classList.remove('hidden');
    document.getElementById('devices-limit-info').textContent = '加载中…';
    await loadLinkDevices();
}

function toggleDeviceRemoveBtn() {
    var checked = document.querySelectorAll('.device-checkbox:checked').length;
    document.getElementById('devices-remove-btn').disabled = (checked === 0);
}

async function loadLinkDevices() {
    var container = document.getElementById('login-link-devices-list');
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">加载中…</div>';
    try {
        var response = await fetch(API_BASE + '/login-links/' + currentDevicesLinkId + '/devices', { credentials: 'include' });
        var data = await response.json();
        if (!response.ok) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c;">' + escapeHtml(data.detail || '加载失败') + '</div>';
            return;
        }
        var devices = data.devices || [];
        var maxD = data.max_devices || 5;
        document.getElementById('devices-limit-info').innerHTML =
            '该链接最多允许 <strong>' + maxD + '</strong> 台不同设备登录，当前已使用 <strong>' + devices.length + '</strong> 台。' +
            (devices.length >= maxD ? '<span style="color:#e74c3c;">已达上限，移除设备后新设备才能登录。</span>' : '移除设备可为新设备腾出位置。');
        if (devices.length === 0) {
            container.innerHTML = '<div style="padding:30px;text-align:center;color:#666;">暂无设备记录（还没有设备通过该链接登录过）</div>';
            document.getElementById('devices-remove-btn').disabled = true;
            return;
        }
        var html = '<table class="share-links-table"><thead><tr>' +
            '<th><input type="checkbox" onchange="var c=this.checked;document.querySelectorAll(\'.device-checkbox\').forEach(function(x){x.checked=c;});toggleDeviceRemoveBtn();"></th>' +
            '<th>设备指纹</th><th>IP地址</th><th>设备/浏览器</th><th>登录次数</th><th>首次登录</th><th>最近登录</th>' +
            '</tr></thead><tbody>';
        devices.forEach(function(d) {
            var ua = (d.user_agent || '-');
            var uaShort = ua.length > 40 ? ua.slice(0, 40) + '…' : ua;
            html += '<tr>';
            html += '<td><input type="checkbox" class="device-checkbox" value="' + d.id + '" onchange="toggleDeviceRemoveBtn()"></td>';
            html += '<td title="' + escapeHtml(d.fingerprint_hash) + '">' + escapeHtml(d.fingerprint_hash.slice(0, 12)) + '…</td>';
            html += '<td>' + escapeHtml(d.ip_address || '-') + '</td>';
            html += '<td title="' + escapeHtml(ua) + '">' + escapeHtml(uaShort) + '</td>';
            html += '<td>' + d.use_count + '</td>';
            html += '<td>' + formatDate(d.first_seen) + '</td>';
            html += '<td>' + formatDate(d.last_seen) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        document.getElementById('devices-remove-btn').disabled = true;
    } catch (error) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c;">网络错误</div>';
    }
}

async function removeSelectedDevices() {
    var ids = Array.from(document.querySelectorAll('.device-checkbox:checked')).map(function(x) { return parseInt(x.value); });
    if (ids.length === 0) return;
    if (!confirm('确定移除选中的 ' + ids.length + ' 台设备吗？移除后这些设备需要重新登录，同时为新设备腾出位置。')) return;
    try {
        var response = await fetch(API_BASE + '/login-links/' + currentDevicesLinkId + '/devices/remove', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_ids: ids })
        });
        var data = await response.json();
        if (response.ok) {
            await loadLinkDevices();
        } else {
            alert(data.detail || '移除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}
