/**
 * 权限配置功能
 */

// 权限弹窗相关变量
var permTargetType = null;
var permTargetId = null;
var permTargetName = null;

// 批量权限相关变量
var batchPermTargetType = null;
var batchPermTargetId = null;
var batchPermTargetName = null;

// ==================== 通用函数 ====================

// 加载所有用户和用户组
function loadAllPermTargets(containerId, selectFn) {
    fetch(API_BASE + '/search/users-and-groups?q=', {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        var results = data.results || [];
        renderPermResults(results, containerId, selectFn);
    })
    .catch(function(err) {
        console.error('加载用户和用户组失败:', err);
    });
}

// 渲染搜索结果（分两列显示）
function renderPermResults(results, containerId, selectFn) {
    var users = results.filter(function(r) { return r.type === 'user'; });
    var groups = results.filter(function(r) { return r.type === 'group'; });
    
    var html = '<div class="perm-results-columns">';
    
    // 用户列
    html += '<div class="perm-column">';
    html += '<div class="perm-column-header">👤 用户</div>';
    if (users.length > 0) {
        users.forEach(function(item) {
            html += '<div class="search-result-item" onclick="' + selectFn + '(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name).replace(/'/g, "\\'") + '\')">';
            html += '<span>' + escapeHtml(item.name) + '</span>';
            html += '</div>';
        });
    } else {
        html += '<div class="search-result-item"><span style="color:#999;">暂无用户</span></div>';
    }
    html += '</div>';
    
    // 用户组列
    html += '<div class="perm-column">';
    html += '<div class="perm-column-header">👥 用户组</div>';
    if (groups.length > 0) {
        groups.forEach(function(item) {
            html += '<div class="search-result-item" onclick="' + selectFn + '(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name).replace(/'/g, "\\'") + '\')">';
            html += '<span>' + escapeHtml(item.name) + '</span>';
            html += '</div>';
        });
    } else {
        html += '<div class="search-result-item"><span style="color:#999;">暂无用户组</span></div>';
    }
    html += '</div>';
    
    html += '</div>';
    
    document.getElementById(containerId).innerHTML = html;
}

// ==================== 单个权限配置 ====================

// 显示权限配置弹窗
function showPermissionModal(resourceType, resourceId, resourceName) {
    document.getElementById('permission-modal-title').textContent = '配置权限: ' + resourceName;
    document.getElementById('perm-resource-type').value = resourceType;
    document.getElementById('perm-resource-id').value = resourceId;
    document.getElementById('perm-search-input').value = '';
    document.getElementById('perm-selected-target').style.display = 'none';
    document.getElementById('permission-modal').classList.remove('hidden');
    loadAllPermTargets('perm-search-results', 'selectPermTarget');
    loadExistingPermissions(resourceType, resourceId);
}

// 加载已有权限列表
function loadExistingPermissions(resourceType, resourceId) {
    var container = document.getElementById('existing-permissions');
    if (!container) return;
    container.innerHTML = '<div style="color:#999;font-size:13px;">加载中...</div>';
    
    fetch(API_BASE + '/resource-permissions/' + resourceType + '/' + resourceId, {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        var users = data.users || [];
        var groups = data.groups || [];
        var html = '';
        
        if (users.length === 0 && groups.length === 0) {
            html = '<div style="color:#999;font-size:13px;padding:8px 0;">暂无已授权的用户或用户组</div>';
        } else {
            html = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;">';
            html += '<div style="font-size:13px;font-weight:600;color:#555;margin-bottom:8px;">已授权列表（点击移除）</div>';
            
            users.forEach(function(u) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:13px;background:#f8f9fa;border-radius:4px;margin-bottom:4px;">';
                html += '<span>👤 ' + escapeHtml(u.username) + '</span>';
                html += '<button class="btn-sm" style="color:#e74c3c;cursor:pointer;background:none;border:1px solid #e74c3c;border-radius:3px;padding:2px 8px;font-size:12px;" onclick="removePermissionItem(\'user\', ' + u.id + ', \'' + resourceType + '\', ' + resourceId + ')">移除</button>';
                html += '</div>';
            });
            
            groups.forEach(function(g) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:13px;background:#f8f9fa;border-radius:4px;margin-bottom:4px;">';
                html += '<span>👥 ' + escapeHtml(g.name) + '</span>';
                html += '<button class="btn-sm" style="color:#e74c3c;cursor:pointer;background:none;border:1px solid #e74c3c;border-radius:3px;padding:2px 8px;font-size:12px;" onclick="removePermissionItem(\'group\', ' + g.id + ', \'' + resourceType + '\', ' + resourceId + ')">移除</button>';
                html += '</div>';
            });
            
            html += '</div>';
        }
        container.innerHTML = html;
    })
    .catch(function(err) {
        container.innerHTML = '<div style="color:#e74c3c;font-size:13px;">加载已有权限失败</div>';
    });
}

// 移除权限
function removePermissionItem(targetType, targetId, resourceType, resourceId) {
    var typeLabel = targetType === 'user' ? '用户' : '用户组';
    if (!confirm('确定要移除该' + typeLabel + '的权限吗？')) return;
    
    fetch(API_BASE + '/permissions/' + targetType + '/' + targetId + '/' + resourceType + '/' + resourceId, {
        credentials: 'include',
        method: 'DELETE'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.message) {
            loadExistingPermissions(resourceType, resourceId);
        } else {
            alert(data.detail || '移除失败');
        }
    })
    .catch(function(err) {
        console.error('移除权限失败:', err);
        alert('网络错误，请重试');
    });
}

// 搜索用户和用户组
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

// 选择目标用户/用户组
function selectPermTarget(type, id, name) {
    permTargetType = type;
    permTargetId = id;
    permTargetName = name;
    
    var typeLabel = type === 'user' ? '用户' : '用户组';
    document.getElementById('perm-target-display').textContent = typeLabel + ': ' + name;
    document.getElementById('perm-selected-target').style.display = 'block';
    document.getElementById('perm-search-results').innerHTML = '';
    document.getElementById('perm-search-input').value = '';
}

// 清除选择
function clearPermTarget() {
    permTargetType = null;
    permTargetId = null;
    permTargetName = null;
    document.getElementById('perm-selected-target').style.display = 'none';
}

// 保存权限
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
            loadDocuments();
        } else {
            alert(data.detail || '配置失败');
        }
    })
    .catch(function(err) {
        console.error('保存权限失败:', err);
        alert('网络错误，请重试');
    });
}

// ==================== 批量权限配置 ====================

// 显示批量权限弹窗
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

// 搜索批量权限目标
function searchBatchPermTargets() {
    var query = document.getElementById('batch-perm-search').value.trim();
    if (query.length < 1) {
        loadAllPermTargets('batch-perm-results', 'selectBatchPermTarget');
        return;
    }
    
    fetch(API_BASE + '/search/users-and-groups?q=' + encodeURIComponent(query), {
        credentials: 'include'
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        renderPermResults(data.results || [], 'batch-perm-results', 'selectBatchPermTarget');
    });
}

// 选择批量权限目标
function selectBatchPermTarget(type, id, name) {
    batchPermTargetType = type;
    batchPermTargetId = id;
    batchPermTargetName = name;
    
    var typeLabel = type === 'user' ? '用户' : '用户组';
    document.getElementById('batch-perm-display').textContent = typeLabel + ': ' + name;
    document.getElementById('batch-perm-selected').style.display = 'block';
    document.getElementById('batch-perm-results').innerHTML = '';
    document.getElementById('batch-perm-search').value = '';
}

// 清除批量权限目标
function clearBatchPermTarget() {
    batchPermTargetType = null;
    batchPermTargetId = null;
    batchPermTargetName = null;
    document.getElementById('batch-perm-selected').style.display = 'none';
}

// 保存批量权限
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
    })
    .catch(function(err) {
        console.error('批量权限保存失败:', err);
        alert('网络错误，请重试');
    });
}
