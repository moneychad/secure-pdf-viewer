/**
 * 权限配置功能
 */

// 权限弹窗相关变量
var permTargetType = null;  // 'user' 或 'group'
var permTargetId = null;
var permTargetName = null;

// 批量权限相关变量
var batchPermTargetType = null;
var batchPermTargetId = null;
var batchPermTargetName = null;

// ==================== 单个权限配置 ====================

// 显示权限配置弹窗
function showPermissionModal(resourceType, resourceId, resourceName) {
    document.getElementById('permission-modal-title').textContent = '配置权限: ' + resourceName;
    document.getElementById('perm-resource-type').value = resourceType;
    document.getElementById('perm-resource-id').value = resourceId;
    document.getElementById('perm-search-input').value = '';
    document.getElementById('perm-search-results').innerHTML = '';
    document.getElementById('perm-selected-target').style.display = 'none';
    
    permTargetType = null;
    permTargetId = null;
    permTargetName = null;
    
    document.getElementById('permission-modal').classList.remove('hidden');
}

// 搜索用户和用户组
function searchPermTargets() {
    var query = document.getElementById('perm-search-input').value.trim();
    
    if (query.length < 1) {
        document.getElementById('perm-search-results').innerHTML = '';
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
            
            html += '<div class="search-result-item" onclick="selectPermTarget(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name) + '\')">';
            html += '<span class="search-result-type ' + typeClass + '">' + typeLabel + '</span>';
            html += '<span>' + escapeHtml(item.name) + '</span>';
            html += '</div>';
        });
        
        if (results.length === 0) {
            html = '<div class="search-result-item"><span style="color:#999;">未找到匹配项</span></div>';
        }
        
        document.getElementById('perm-search-results').innerHTML = html;
    })
    .catch(function(err) {
        console.error('搜索失败:', err);
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
    document.getElementById('batch-perm-results').innerHTML = '';
    document.getElementById('batch-perm-selected').style.display = 'none';
    
    batchPermTargetType = null;
    batchPermTargetId = null;
    batchPermTargetName = null;
    
    document.getElementById('batch-permission-modal').classList.remove('hidden');
}

// 搜索批量权限目标
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
            
            html += '<div class="search-result-item" onclick="selectBatchPermTarget(\'' + item.type + '\', ' + item.id + ', \'' + escapeHtml(item.name) + '\')">';
            html += '<span class="search-result-type ' + typeClass + '">' + typeLabel + '</span>';
            html += '<span>' + escapeHtml(item.name) + '</span>';
            html += '</div>';
        });
        
        if (results.length === 0) {
            html = '<div class="search-result-item"><span style="color:#999;">未找到匹配项</span></div>';
        }
        
        document.getElementById('batch-perm-results').innerHTML = html;
    })
    .catch(function(err) {
        console.error('搜索失败:', err);
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
    
    // 构建批量数据
    var items = [];
    
    // 添加文件
    selectedDocuments.forEach(function(docId) {
        items.push({ resource_type: 'document', resource_id: docId, can_read: true });
    });
    
    // 添加目录
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
