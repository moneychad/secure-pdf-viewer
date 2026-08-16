// 扩展 showPage 函数
const _originalShowPage = showPage;
showPage = function(pageName) {
    _originalShowPage(pageName);
    
    switch (pageName) {
        case 'groups':
            if (typeof loadGroups === 'function') loadGroups();
            break;
        case 'audit-logs':
            if (typeof loadAuditLogs === 'function') loadAuditLogs();
            break;
        case 'permissions':
            if (typeof loadPermissionTargets === 'function') loadPermissionTargets();
            break;
    }
};

// 扩展 renderUsers 函数，添加用户组显示
const _originalRenderUsers = renderUsers;
renderUsers = function(users) {
    const tbody = document.getElementById('users-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">暂无用户</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${user.role === 'admin' ? '管理员' : '普通用户'}</td>
            <td>${escapeHtml(user.group_name || '未分组')}</td>
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
                ${user.username !== currentUser.username ? '<button class="btn-action btn-delete" onclick="deleteUser(' + user.id + ')" title="删除">🗑️</button>' : ''}
            </td>
        </tr>
    `).join('');
};
