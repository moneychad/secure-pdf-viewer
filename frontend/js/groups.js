/**
 * 用户组管理和权限配置功能
 */

// 全局变量
var allGroups = [];

// ==================== 用户组管理 ====================

async function loadGroups() {
    try {
        var response = await fetch(API_BASE + '/groups', {
            credentials: 'include'
        });
        var data = await response.json();
        if (response.ok) {
            allGroups = data.groups;
            renderGroups(data.groups);
        }
    } catch (error) {
        console.error('加载用户组失败:', error);
    }
}

function renderGroups(groups) {
    var tbody = document.getElementById('groups-body');
    if (!groups || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">暂无用户组</td></tr>';
        return;
    }
    
    tbody.innerHTML = groups.map(function(group) {
        var members = group.member_names || '暂无成员';
        return '<tr>' +
            '<td>' + group.id + '</td>' +
            '<td>' + escapeHtml(group.name) + '</td>' +
            '<td>' + escapeHtml(group.description || '-') + '</td>' +
            '<td class="members-cell">' + escapeHtml(members) + '</td>' +
            '<td>' + formatDate(group.created_at) + '</td>' +
            '<td>' +
                '<button class="btn-action btn-edit" onclick="editGroup(' + group.id + ')" title="编辑">✏️</button>' +
                '<button class="btn-action btn-delete" onclick="deleteGroup(' + group.id + ')" title="删除">🗑️</button>' +
                '<button class="btn-action btn-move" onclick="showGroupMembersModal(' + group.id + ')" title="成员管理">👥</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function createGroup() {
    var name = document.getElementById('new-group-name').value.trim();
    var desc = document.getElementById('new-group-desc').value.trim();
    if (!name) {
        alert('请输入用户组名称');
        return;
    }
    
    fetch(API_BASE + '/groups', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, description: desc })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.group_id) {
            document.getElementById('new-group-name').value = '';
            document.getElementById('new-group-desc').value = '';
            loadGroups();
            alert('用户组创建成功');
        } else {
            alert(data.detail || '创建失败');
        }
    })
    .catch(function(err) {
        console.error('创建用户组错误:', err);
        alert('网络错误，请重试');
    });
}

async function editGroup(groupId) {
    var group = allGroups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    
    var newName = prompt('请输入新组名:', group.name);
    if (!newName || newName === group.name) return;
    
    try {
        var response = await fetch(API_BASE + '/groups/' + groupId, {
            credentials: 'include',
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        if (response.ok) {
            loadGroups();
        } else {
            var data = await response.json();
            alert(data.detail || '修改失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('确定要删除此用户组吗？组内用户将被移出该组。')) return;
    try {
        var response = await fetch(API_BASE + '/groups/' + groupId, {
            credentials: 'include',
            method: 'DELETE'
        });
        if (response.ok) {
            loadGroups();
        } else {
            var data = await response.json();
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// ==================== 成员管理弹窗 ====================

async function showGroupMembersModal(groupId) {
    var group = allGroups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    
    // 获取组内成员
    var members = [];
    try {
        var resp = await fetch(API_BASE + '/groups/' + groupId + '/members', { credentials: 'include' });
        var data = await resp.json();
        if (data.members) members = data.members;
    } catch (e) {}
    
    // 获取所有未分组用户
    var allUsers = [];
    try {
        var resp2 = await fetch(API_BASE + '/admin/users', { credentials: 'include' });
        var data2 = await resp2.json();
        if (data2.users) allUsers = data2.users;
    } catch (e) {}
    
    var ungroupedUsers = allUsers.filter(function(u) { return !u.group_id; });
    
    // 创建或获取弹窗
    var modal = document.getElementById('group-members-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'group-members-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    var membersHtml = '';
    if (members.length > 0) {
        members.forEach(function(m) {
            membersHtml += '<label class="member-item"><input type="checkbox" class="member-checkbox" value="' + m.id + '"> ' + escapeHtml(m.username) + '</label>';
        });
    } else {
        membersHtml = '<div class="perm-empty">暂无成员</div>';
    }
    
    var addOptionsHtml = '';
    if (ungroupedUsers.length > 0) {
        ungroupedUsers.forEach(function(u) {
            addOptionsHtml += '<label class="member-item"><input type="checkbox" class="add-member-checkbox" value="' + u.id + '"> ' + escapeHtml(u.username) + '</label>';
        });
    } else {
        addOptionsHtml = '<div class="perm-empty">暂无可添加的用户</div>';
    }
    
    modal.innerHTML = '<div class="modal-content" style="min-width:600px;">' +
        '<h3>成员管理: ' + escapeHtml(group.name) + '</h3>' +
        '<div class="members-columns">' +
            '<div class="members-column">' +
                '<div class="members-header">👥 当前成员 (' + members.length + '人)</div>' +
                '<div class="members-list" id="current-members-list">' + membersHtml + '</div>' +
                '<button class="btn-danger" style="margin-top:10px;" onclick="removeSelectedMembers(' + groupId + ')">移除选中成员</button>' +
            '</div>' +
            '<div class="members-column">' +
                '<div class="members-header">➕ 添加成员 (未分组用户: ' + ungroupedUsers.length + '人)</div>' +
                '<div class="members-list" id="add-members-list">' + addOptionsHtml + '</div>' +
                '<button class="btn-primary" style="margin-top:10px;" onclick="addSelectedMembers(' + groupId + ')">添加选中成员</button>' +
            '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="btn-secondary" onclick="closeModal(\'group-members-modal\')">关闭</button>' +
        '</div>' +
    '</div>';
    
    modal.classList.remove('hidden');
}

async function removeSelectedMembers(groupId) {
    var checkboxes = document.querySelectorAll('#current-members-list .member-checkbox:checked');
    var userIds = Array.from(checkboxes).map(function(cb) { return parseInt(cb.value); });
    
    if (userIds.length === 0) {
        alert('请选择要移除的成员');
        return;
    }
    
    try {
        var resp = await fetch(API_BASE + '/groups/' + groupId + '/members/remove', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds })
        });
        var data = await resp.json();
        if (data.message) {
            alert(data.message);
            showGroupMembersModal(groupId);
            loadGroups();
            loadUsers();
        } else {
            alert(data.detail || '移除失败');
        }
    } catch (e) {
        alert('网络错误，请重试');
    }
}

async function addSelectedMembers(groupId) {
    var checkboxes = document.querySelectorAll('#add-members-list .add-member-checkbox:checked');
    var userIds = Array.from(checkboxes).map(function(cb) { return parseInt(cb.value); });
    
    if (userIds.length === 0) {
        alert('请选择要添加的成员');
        return;
    }
    
    try {
        var resp = await fetch(API_BASE + '/groups/' + groupId + '/members/add', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds })
        });
        var data = await resp.json();
        if (data.message) {
            alert(data.message);
            showGroupMembersModal(groupId);
            loadGroups();
            loadUsers();
        } else {
            alert(data.detail || '添加失败');
        }
    } catch (e) {
        alert('网络错误，请重试');
    }
}

// ==================== 权限配置 ====================

async function loadPermissionTargets() {
    var targetType = document.getElementById('perm-target-type').value;
    var select = document.getElementById('perm-target-id');
    
    try {
        if (targetType === 'user') {
            var response = await fetch(API_BASE + '/admin/users', { credentials: 'include' });
            var data = await response.json();
            if (response.ok) {
                select.innerHTML = data.users.map(function(u) {
                    return '<option value="' + u.id + '">' + escapeHtml(u.username) + (u.group_name ? ' (' + u.group_name + ')' : '') + '</option>';
                }).join('');
            }
        } else {
            var response = await fetch(API_BASE + '/groups', { credentials: 'include' });
            var data = await response.json();
            if (response.ok) {
                select.innerHTML = data.groups.map(function(g) {
                    return '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>';
                }).join('');
            }
        }
    } catch (error) {
        console.error('加载目标失败:', error);
    }
}

async function loadPermissions() {
    var targetType = document.getElementById('perm-target-type').value;
    var targetId = document.getElementById('perm-target-id').value;
    
    if (!targetId) {
        alert('请选择配置对象');
        return;
    }
    
    try {
        var permResponse = await fetch(API_BASE + '/permissions/' + targetType + '/' + targetId, { credentials: 'include' });
        var permData = await permResponse.json();
        
        var folderResponse = await fetch(API_BASE + '/folders?parent_id=1', { credentials: 'include' });
        var folderData = await folderResponse.json();
        
        if (permResponse.ok && folderResponse.ok) {
            renderFolderPermissions(folderData.folders, permData.folder_permissions, targetType, targetId);
            renderDocumentPermissions(permData.document_permissions, targetType, targetId);
        }
    } catch (error) {
        console.error('加载权限失败:', error);
    }
}

function renderFolderPermissions(folders, permissions, targetType, targetId) {
    var container = document.getElementById('folder-permissions');
    if (!folders || folders.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;">暂无目录</p>';
        return;
    }
    
    var permMap = {};
    permissions.forEach(function(p) { permMap[p.folder_id] = p.can_read; });
    
    container.innerHTML = folders.map(function(folder) {
        var hasPerm = permMap[folder.id] === 1;
        return '<div class="permission-item">' +
            '<label>' +
                '<input type="checkbox" ' + (hasPerm ? 'checked' : '') + 
                ' onchange="setFolderPermission(\'' + targetType + '\', ' + targetId + ', ' + folder.id + ', this.checked)">' +
                '<span class="folder-icon">📁</span>' +
                '<span>' + escapeHtml(folder.name) + ' (' + folder.doc_count + ' 个文件)</span>' +
            '</label>' +
            '<span class="perm-status ' + (hasPerm ? 'perm-granted' : 'perm-denied') + '">' + (hasPerm ? '已授权' : '未授权') + '</span>' +
        '</div>';
    }).join('');
}

function renderDocumentPermissions(permissions, targetType, targetId) {
    var container = document.getElementById('document-permissions');
    if (!permissions || permissions.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;">暂无单独配置的文件权限</p>';
        return;
    }
    
    container.innerHTML = permissions.map(function(perm) {
        return '<div class="permission-item">' +
            '<label>' +
                '<input type="checkbox" checked onchange="setDocumentPermission(\'' + targetType + '\', ' + targetId + ', ' + perm.document_id + ', this.checked)">' +
                '<span>📄 ' + escapeHtml(perm.document_name) + '</span>' +
            '</label>' +
            '<button class="btn-action btn-delete" onclick="removeDocumentPermission(\'' + targetType + '\', ' + targetId + ', ' + perm.document_id + ')" title="移除权限">🗑️</button>' +
        '</div>';
    }).join('');
}

async function setFolderPermission(targetType, targetId, folderId, canRead) {
    try {
        var response = await fetch(API_BASE + '/permissions', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_type: targetType,
                target_id: parseInt(targetId),
                resource_type: 'folder',
                resource_id: folderId,
                can_read: canRead
            })
        });
        if (!response.ok) {
            var data = await response.json();
            alert(data.detail || '设置失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function setDocumentPermission(targetType, targetId, docId, canRead) {
    try {
        var response = await fetch(API_BASE + '/permissions', {
            credentials: 'include',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_type: targetType,
                target_id: parseInt(targetId),
                resource_type: 'document',
                resource_id: docId,
                can_read: canRead
            })
        });
        if (!response.ok) {
            var data = await response.json();
            alert(data.detail || '设置失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function removeDocumentPermission(targetType, targetId, docId) {
    try {
        var response = await fetch(API_BASE + '/permissions/' + targetType + '/' + targetId + '/document/' + docId, {
            credentials: 'include',
            method: 'DELETE'
        });
        if (response.ok) {
            loadPermissions();
        } else {
            var data = await response.json();
            alert(data.detail || '移除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// 绑定事件
document.addEventListener('DOMContentLoaded', function() {
    var createGroupBtn = document.querySelector('#create-group-form button');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', function(e) {
            e.preventDefault();
            createGroup();
        });
    }
});
