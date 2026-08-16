/**
 * 用户组管理和权限配置功能
 */

// 全局变量
let allGroups = [];

// ==================== 用户组管理 ====================

async function loadGroups() {
    try {
        const response = await fetch(API_BASE + '/groups', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            allGroups = data.groups;
            renderGroups(data.groups);
        }
    } catch (error) {
        console.error('加载用户组失败:', error);
    }
}

function renderGroups(groups) {
    const tbody = document.getElementById('groups-body');
    
    if (!groups || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">暂无用户组</td></tr>';
        return;
    }
    
    tbody.innerHTML = groups.map(function(group) {
        return '<tr>' +
            '<td>' + group.id + '</td>' +
            '<td>' + escapeHtml(group.name) + '</td>' +
            '<td>' + escapeHtml(group.description || '-') + '</td>' +
            '<td>' + (group.member_names ? group.member_names : '暂无成员') + '</td>' +
            '<td>' + formatDate(group.created_at) + '</td>' +
            '<td>' +
                '<button class="btn-action btn-edit" onclick="editGroup(' + group.id + ')" title="编辑">✏️</button>' +
                '<button class="btn-action btn-delete" onclick="deleteGroup(' + group.id + ')" title="删除">🗑️</button>' +
                '<button class="btn-action btn-move" onclick="showGroupMembers(' + group.id + ')" title="成员管理">👥</button>' +
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
    const group = allGroups.find(g => g.id === groupId);
    if (!group) return;
    
    const newName = prompt('请输入新组名:', group.name);
    if (!newName || newName === group.name) return;
    
    try {
        const response = await fetch(API_BASE + '/groups/' + groupId, {
            credentials: 'include',
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            loadGroups();
        } else {
            alert(data.detail || '修改失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('确定要删除此用户组吗？组内用户将被移出该组。')) return;
    
    try {
        const response = await fetch(API_BASE + '/groups/' + groupId, {
            credentials: 'include',
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            loadGroups();
        } else {
            alert(data.detail || '删除失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function showGroupMembers(groupId) {
    const group = allGroups.find(g => g.id === groupId);
    if (!group) return;
    
    try {
        const response = await fetch(API_BASE + '/groups/' + groupId + '/members', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            let memberList = data.members.map(m => m.username).join(', ') || '暂无成员';
            const action = prompt(
                '用户组: ' + group.name + '\n成员: ' + memberList + '\n\n请输入操作:\n1. 添加成员 (输入用户名)\n2. 移除成员 (输入 -用户名)'
            );
            
            if (action) {
                if (action.startsWith('-')) {
                    const username = action.substring(1).trim();
                    await removeGroupMember(username);
                } else {
                    await addGroupMember(action.trim(), groupId);
                }
            }
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function addGroupMember(username, groupId) {
    try {
        const response = await fetch(API_BASE + '/admin/users', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const user = data.users.find(u => u.username === username);
            if (!user) {
                alert('用户不存在: ' + username);
                return;
            }
            
            const updateResponse = await fetch(API_BASE + '/admin/users/' + user.id, {
                credentials: 'include',
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: groupId })
            });
            
            if (updateResponse.ok) {
                alert('已将 ' + username + ' 添加到用户组');
                loadGroups();
                loadUsers();
            } else {
                alert('添加失败');
            }
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function removeGroupMember(username) {
    try {
        const response = await fetch(API_BASE + '/admin/users', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const user = data.users.find(u => u.username === username);
            if (!user) {
                alert('用户不存在: ' + username);
                return;
            }
            
            const updateResponse = await fetch(API_BASE + '/admin/users/' + user.id, {
                credentials: 'include',
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: null })
            });
            
            if (updateResponse.ok) {
                alert('已将 ' + username + ' 移出用户组');
                loadGroups();
                loadUsers();
            } else {
                alert('移除失败');
            }
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

// ==================== 权限配置 ====================

async function loadPermissionTargets() {
    const targetType = document.getElementById('perm-target-type').value;
    const select = document.getElementById('perm-target-id');
    
    try {
        if (targetType === 'user') {
            const response = await fetch(API_BASE + '/admin/users', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (response.ok) {
                select.innerHTML = data.users.map(function(u) {
                    return '<option value="' + u.id + '">' + escapeHtml(u.username) + (u.group_name ? ' (' + u.group_name + ')' : '') + '</option>';
                }).join('');
            }
        } else {
            const response = await fetch(API_BASE + '/groups', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (response.ok) {
                select.innerHTML = data.groups.map(function(g) {
                    return '<option value="' + g.id + '">' + escapeHtml(g.name) + ' (' + g.member_count + '人)</option>';
                }).join('');
            }
        }
    } catch (error) {
        console.error('加载目标失败:', error);
    }
}

async function loadPermissions() {
    const targetType = document.getElementById('perm-target-type').value;
    const targetId = document.getElementById('perm-target-id').value;
    
    if (!targetId) {
        alert('请选择配置对象');
        return;
    }
    
    try {
        const permResponse = await fetch(API_BASE + '/permissions/' + targetType + '/' + targetId, {
            credentials: 'include'
        });
        const permData = await permResponse.json();
        
        const folderResponse = await fetch(API_BASE + '/folders?parent_id=1', {
            credentials: 'include'
        });
        const folderData = await folderResponse.json();
        
        if (permResponse.ok && folderResponse.ok) {
            renderFolderPermissions(folderData.folders, permData.folder_permissions, targetType, targetId);
            renderDocumentPermissions(permData.document_permissions, targetType, targetId);
        }
    } catch (error) {
        console.error('加载权限失败:', error);
    }
}

function renderFolderPermissions(folders, permissions, targetType, targetId) {
    const container = document.getElementById('folder-permissions');
    
    if (!folders || folders.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;">暂无目录</p>';
        return;
    }
    
    const permMap = {};
    permissions.forEach(function(p) {
        permMap[p.folder_id] = p.can_read;
    });
    
    container.innerHTML = folders.map(function(folder) {
        const hasPerm = permMap[folder.id] === 1;
        
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
    const container = document.getElementById('document-permissions');
    
    if (!permissions || permissions.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;">暂无单独配置的文件权限</p>';
        return;
    }
    
    container.innerHTML = permissions.map(function(perm) {
        return '<div class="permission-item">' +
            '<label>' +
                '<input type="checkbox" checked ' +
                'onchange="setDocumentPermission(\'' + targetType + '\', ' + targetId + ', ' + perm.document_id + ', this.checked)">' +
                '<span>📄 ' + escapeHtml(perm.document_name) + '</span>' +
            '</label>' +
            '<button class="btn-action btn-delete" onclick="removeDocumentPermission(\'' + targetType + '\', ' + targetId + ', ' + perm.document_id + ')" title="移除权限">🗑️</button>' +
        '</div>';
    }).join('');
}

async function setFolderPermission(targetType, targetId, folderId, canRead) {
    try {
        const response = await fetch(API_BASE + '/permissions', {
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
            const data = await response.json();
            alert(data.detail || '设置失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function setDocumentPermission(targetType, targetId, docId, canRead) {
    try {
        const response = await fetch(API_BASE + '/permissions', {
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
            const data = await response.json();
            alert(data.detail || '设置失败');
        }
    } catch (error) {
        alert('网络错误，请重试');
    }
}

async function removeDocumentPermission(targetType, targetId, docId) {
    try {
        const response = await fetch(API_BASE + '/permissions/' + targetType + '/' + targetId + '/document/' + docId, {
            credentials: 'include',
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadPermissions();
        } else {
            const data = await response.json();
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
