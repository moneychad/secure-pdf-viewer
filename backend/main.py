"""
安全文档共享平台 - 后端服务
支持用户组和细粒度权限管理
"""

import os
import json
import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Request, Query

# SQL 更新字段白名单（防止注入）
ALLOWED_USER_UPDATE_FIELDS = {"username", "password_hash", "role", "group_id", "is_active"}
ALLOWED_GROUP_UPDATE_FIELDS = {"name", "description"}
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import jwt
import uvicorn

# 配置
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY or SECRET_KEY == "your-secret-key-change-in-production":
    raise RuntimeError("SECRET_KEY 必须设置且不能是默认值！请通过环境变量 SECRET_KEY 设置一个强密钥。")
UPLOAD_DIR = Path("/opt/secure-pdf-viewer/backend/uploads")
DB_PATH = Path("/opt/secure-pdf-viewer/backend/database.db")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

# 创建目录
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="安全文档共享平台")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://192.168.100.107", "http://localhost", "http://127.0.0.1"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

security = HTTPBearer()

# ==================== 数据库初始化 ====================

def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    
    # 用户表
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'viewer',
        group_id INTEGER DEFAULT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE SET NULL
    )''')
    
    # 用户组表
    c.execute('''CREATE TABLE IF NOT EXISTS user_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # 目录表
    c.execute('''CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT NULL,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    )''')
    
    # 文档表
    c.execute('''CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size INTEGER,
        folder_id INTEGER DEFAULT NULL,
        uploaded_by TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    )''')
    
    # 用户-目录权限表
    c.execute('''CREATE TABLE IF NOT EXISTS user_folder_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        can_read BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
        UNIQUE(user_id, folder_id)
    )''')
    
    # 用户-文档权限表
    c.execute('''CREATE TABLE IF NOT EXISTS user_document_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        can_read BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE(user_id, document_id)
    )''')
    
    # 用户组-目录权限表
    c.execute('''CREATE TABLE IF NOT EXISTS group_folder_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        can_read BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
        UNIQUE(group_id, folder_id)
    )''')
    
    # 用户组-文档权限表
    c.execute('''CREATE TABLE IF NOT EXISTS group_document_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        can_read BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE(group_id, document_id)
    )''')
    
    # 访问日志表
    c.execute('''CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        document_id INTEGER,
        action TEXT,
        page_number INTEGER,
        device_fingerprint TEXT,
        ip_address TEXT,
        user_agent TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration_seconds INTEGER DEFAULT 0
    )''')
    
    # 设备指纹表

    # 审计日志表
    c.execute("""CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        target_name TEXT,
        details TEXT,
        ip_address TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    
    c.execute('''CREATE TABLE IF NOT EXISTS device_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint_hash TEXT UNIQUE,
        username TEXT,
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        canvas_fingerprint TEXT,
        webgl_info TEXT,
        screen_info TEXT,
        timezone TEXT,
        language TEXT
    )''')
    
    # 创建默认管理员
    admin_hash = hash_password(ADMIN_PASSWORD)
    c.execute("INSERT OR IGNORE INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)",
              (ADMIN_USERNAME, admin_hash, "admin", 1))
    
    # 创建默认根目录
    c.execute("INSERT OR IGNORE INTO folders (id, name, parent_id, created_by) VALUES (1, '根目录', NULL, 'system')")
    
    conn.commit()
    conn.close()


# ==================== Pydantic 模型 ====================

class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"
    group_id: Optional[int] = None

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    group_id: Optional[int] = None
    is_active: Optional[bool] = None

class ChangePassword(BaseModel):
    old_password: str
    new_password: str

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = 1

class FolderUpdate(BaseModel):
    name: str

class DocumentMove(BaseModel):
    folder_id: int

class BatchDelete(BaseModel):
    document_ids: List[int]

class BatchMove(BaseModel):
    document_ids: List[int]
    folder_id: int

class PermissionCreate(BaseModel):
    target_type: str  # 'user' 或 'group'
    target_id: int
    resource_type: str  # 'folder' 或 'document'
    resource_id: int
    can_read: bool = True

class BatchPermissionCreate(BaseModel):
    target_type: str
    target_id: int
    permissions: List[dict]  # [{resource_type, resource_id, can_read}, ...]

class DeviceFingerprint(BaseModel):
    fingerprint_hash: str
    canvas_fingerprint: str
    webgl_info: dict
    screen_info: dict
    timezone: str
    language: str
    user_agent: str

class AccessLog(BaseModel):
    document_id: int
    action: str
    page_number: Optional[int] = None
    device_fingerprint: str
    duration_seconds: Optional[int] = 0

# ==================== 工具函数 ====================

import bcrypt

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()


init_db()
def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except:
        return False

def create_token(username: str, role: str, user_id: int) -> str:
    payload = {
        "username": username,
        "role": role,
        "user_id": user_id,
        "exp": datetime.now(timezone.utc).timestamp() + 86400
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def verify_token(request: Request):
    # 优先从 Authorization header 读取
    auth_header = request.headers.get("Authorization")
    token = None
    
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
    
    # 如果 header 没有，尝试从 Cookie 读取
    if not token:
        token = request.cookies.get("auth_token")
    
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload
    except:
        raise HTTPException(status_code=401, detail="无效的认证令牌")

def log_audit(conn, user_id, username, action, target_type=None, target_id=None, target_name=None, details=None, ip_address=None):
    """记录审计日志"""
    c = conn.cursor()
    from datetime import timedelta
    beijing_time = datetime.now(timezone(timedelta(hours=8)))
    
    c.execute("""INSERT INTO audit_logs 
                (user_id, username, action, target_type, target_id, target_name, details, ip_address, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
              (user_id, username, action, target_type, target_id, target_name, details, ip_address, 
               beijing_time.strftime('%Y-%m-%d %H:%M:%S')))

def get_db():
    """获取数据库连接（注意：调用方需要手动关闭连接）"""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def check_folder_permission(user_id: int, folder_id: int, db, depth: int = 0) -> bool:
    """检查用户是否有目录的读取权限（包括继承）"""
    # 防止无限递归
    if depth > 10:
        return False
    
    c = db.cursor()
    
    # 获取用户信息
    c.execute("SELECT role, group_id FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    
    # 管理员拥有所有权限
    if user and user["role"] == "admin":
        return True
    
    # 检查直接用户权限
    c.execute("""SELECT id FROM user_folder_permissions 
                WHERE user_id = ? AND folder_id = ? AND can_read = 1""",
              (user_id, folder_id))
    if c.fetchone():
        return True
    
    # 检查用户组权限
    if user and user["group_id"]:
        c.execute("""SELECT id FROM group_folder_permissions 
                    WHERE group_id = ? AND folder_id = ? AND can_read = 1""",
                  (user["group_id"], folder_id))
        if c.fetchone():
            return True
    
    # 检查父目录权限（继承）
    c.execute("SELECT parent_id FROM folders WHERE id = ?", (folder_id,))
    folder = c.fetchone()
    if folder and folder["parent_id"]:
        return check_folder_permission(user_id, folder["parent_id"], db, depth + 1)
    
    return False

def check_document_permission(user_id: int, document_id: int, db) -> bool:
    """检查用户是否有文档的读取权限"""
    c = db.cursor()
    
    # 获取用户信息
    c.execute("SELECT role, group_id FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    
    # 管理员拥有所有权限
    if user and user["role"] == "admin":
        return True
    
    # 检查直接用户权限
    c.execute("""SELECT id FROM user_document_permissions 
                WHERE user_id = ? AND document_id = ? AND can_read = 1""",
              (user_id, document_id))
    if c.fetchone():
        return True
    
    # 检查用户组权限
    if user and user["group_id"]:
        c.execute("""SELECT id FROM group_document_permissions 
                    WHERE group_id = ? AND document_id = ? AND can_read = 1""",
                  (user["group_id"], document_id))
        if c.fetchone():
            return True
    
    # 检查文档所在目录的权限（继承）
    c.execute("SELECT folder_id FROM documents WHERE id = ?", (document_id,))
    doc = c.fetchone()
    if doc and doc["folder_id"]:
        return check_folder_permission(user_id, doc["folder_id"], db)
    
    return False

def get_user_accessible_folder_ids(user_id: int, db) -> List[int]:
    """获取用户有权限访问的所有目录ID"""
    c = db.cursor()
    
    accessible_ids = set()
    
    # 获取用户信息
    c.execute("SELECT role, group_id FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    
    # 管理员可以访问所有目录
    if user and user["role"] == "admin":
        c.execute("SELECT id FROM folders WHERE is_active = 1")
        return [row["id"] for row in c.fetchall()]
    
    # 获取用户直接有权限的目录
    c.execute("SELECT folder_id FROM user_folder_permissions WHERE user_id = ? AND can_read = 1",
              (user_id,))
    for row in c.fetchall():
        accessible_ids.add(row["folder_id"])
        # 添加所有子目录
        _add_child_folder_ids(row["folder_id"], accessible_ids, db)
    
    # 获取用户组有权限的目录
    if user and user["group_id"]:
        c.execute("SELECT folder_id FROM group_folder_permissions WHERE group_id = ? AND can_read = 1",
                  (user["group_id"],))
        for row in c.fetchall():
            accessible_ids.add(row["folder_id"])
            _add_child_folder_ids(row["folder_id"], accessible_ids, db)
    
    return list(accessible_ids)

def _add_child_folder_ids(folder_id: int, ids_set: set, db):
    """递归添加子目录ID"""
    c = db.cursor()
    c.execute("SELECT id FROM folders WHERE parent_id = ? AND is_active = 1", (folder_id,))
    for row in c.fetchall():
        ids_set.add(row["id"])
        _add_child_folder_ids(row["id"], ids_set, db)

# ==================== 登录频率限制 ====================
from collections import defaultdict
import time

# 登录尝试记录: {ip: [(timestamp, count), ...]}
login_attempts = defaultdict(list)
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_MINUTES = 15

def check_login_rate_limit(ip: str) -> tuple:
    """检查登录频率限制，返回 (是否允许, 剩余尝试次数, 锁定剩余秒数)"""
    now = time.time()
    # 清理过期记录
    login_attempts[ip] = [(t, c) for t, c in login_attempts[ip] if now - t < LOGIN_LOCKOUT_MINUTES * 60]
    
    if not login_attempts[ip]:
        return True, LOGIN_MAX_ATTEMPTS, 0
    
    # 计算最近15分钟内的总尝试次数
    total_attempts = sum(c for _, c in login_attempts[ip])
    
    if total_attempts >= LOGIN_MAX_ATTEMPTS:
        oldest_time = min(t for t, _ in login_attempts[ip])
        lockout_remaining = int(LOGIN_LOCKOUT_MINUTES * 60 - (now - oldest_time))
        return False, 0, max(0, lockout_remaining)
    
    return True, LOGIN_MAX_ATTEMPTS - total_attempts, 0

def record_login_attempt(ip: str, success: bool):
    """记录登录尝试"""
    now = time.time()
    if success:
        # 登录成功，清除记录
        login_attempts.pop(ip, None)
    else:
        # 登录失败，增加计数
        if login_attempts[ip]:
            # 如果最近有记录，增加计数
            login_attempts[ip][-1] = (login_attempts[ip][-1][0], login_attempts[ip][-1][1] + 1)
        else:
            login_attempts[ip].append((now, 1))

# ==================== 认证 API ====================

@app.get("/api/users/me")
async def get_current_user(token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT u.id, u.username, u.role, u.group_id, u.is_active, 
                g.name as group_name
                FROM users u
                LEFT JOIN user_groups g ON u.group_id = g.id
                WHERE u.username = ?""", (token_data["username"],))
    user = c.fetchone()
    conn.close()
    
    if user:
        return dict(user)
    raise HTTPException(status_code=404, detail="User not found")

@app.post("/api/login")
async def login(user: UserLogin, request: Request):
    # 检查登录频率限制
    client_ip = request.client.host
    allowed, remaining, lockout_seconds = check_login_rate_limit(client_ip)
    
    if not allowed:
        raise HTTPException(
            status_code=429, 
            detail=f"登录尝试次数过多，请 {lockout_seconds // 60} 分钟后再试"
        )
    
    conn = get_db()
    c = conn.cursor()
    
    # 先查询用户，再用 bcrypt 验证密码
    c.execute("SELECT id, username, role, is_active, password_hash FROM users WHERE username = ?",
              (user.username,))
    user_data = c.fetchone()
    
    if user_data and not verify_password(user.password, user_data["password_hash"]):
        user_data = None  # 密码不匹配
    
    if not user_data:
        conn.close()
        record_login_attempt(client_ip, success=False)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    
    if not user_data["is_active"]:
        conn.close()
        raise HTTPException(status_code=403, detail="账号已被停用，请联系管理员")
    
    c.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user_data["id"],))
    
    # 记录审计日志（在关闭连接前）
    log_audit(conn, user_data["id"], user_data["username"], "LOGIN", "user", user_data["id"], user_data["username"], None, request.client.host)
    conn.commit()
    conn.close()
    
    # 登录成功，清除失败记录
    record_login_attempt(client_ip, success=True)
    
    token = create_token(user_data["username"], user_data["role"], user_data["id"])
    
    # 创建响应并设置 HttpOnly Cookie
    from fastapi.responses import JSONResponse
    response = JSONResponse(content={
        "token": token,
        "user": {
            "id": user_data["id"],
            "username": user_data["username"],
            "role": user_data["role"]
        }
    })
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        secure=False,  # 开发环境用 False，生产环境应改为 True
        samesite="lax",
        max_age=86400  # 24小时
    )
    return response

@app.post("/api/register")
async def register(user: UserCreate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建用户")
    
    conn = get_db()
    c = conn.cursor()
    
    password_hash = hash_password(user.password)
    try:
        c.execute("INSERT INTO users (username, password_hash, role, group_id, is_active) VALUES (?, ?, ?, ?, ?)",
                  (user.username, password_hash, user.role, user.group_id, 1))
        conn.commit()
        conn.close()
        return {"message": "用户创建成功"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已存在")

@app.post("/api/change-password")
async def change_password(passwords: ChangePassword, token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    
    # 先查询用户当前密码哈希
    c.execute("SELECT password_hash FROM users WHERE username = ?", (token_data["username"],))
    result = c.fetchone()
    
    if not result or not verify_password(passwords.old_password, result["password_hash"]):
        conn.close()
        raise HTTPException(status_code=400, detail="旧密码错误")
    
    new_hash = hash_password(passwords.new_password)
    c.execute("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
              (new_hash, token_data["username"]))
    conn.commit()
    conn.close()
    
    return {"message": "密码修改成功"}

# ==================== 用户组 API ====================

@app.get("/api/groups")
async def list_groups(token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    
    c.execute("""SELECT g.*, 
                (SELECT COUNT(*) FROM users WHERE group_id = g.id AND is_active = 1) as member_count
                FROM user_groups g ORDER BY g.name""")
    groups = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"groups": groups}

@app.post("/api/groups")
async def create_group(group: GroupCreate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建用户组")
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("INSERT INTO user_groups (name, description) VALUES (?, ?)",
                  (group.name, group.description))
        group_id = c.lastrowid
        conn.commit()
        conn.close()
        return {"group_id": group_id, "message": "用户组创建成功"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="用户组名已存在")

@app.put("/api/groups/{group_id}")
async def update_group(group_id: int, group_update: GroupUpdate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以修改用户组")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM user_groups WHERE id = ?", (group_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="用户组不存在")
    
    updates = []
    params = []
    
    if group_update.name is not None:
        if "name" not in ALLOWED_GROUP_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("name = ?")
        params.append(group_update.name)
    
    if group_update.description is not None:
        if "description" not in ALLOWED_GROUP_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("description = ?")
        params.append(group_update.description)
    
    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(group_id)
        c.execute(f"UPDATE user_groups SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    
    conn.close()
    return {"message": "用户组更新成功"}

@app.delete("/api/groups/{group_id}")
async def delete_group(group_id: int, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除用户组")
    
    conn = get_db()
    c = conn.cursor()
    
    # 将组内用户的 group_id 设为 NULL
    c.execute("UPDATE users SET group_id = NULL WHERE group_id = ?", (group_id,))
    
    # 删除用户组
    c.execute("DELETE FROM user_groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()
    
    return {"message": "用户组删除成功"}

@app.get("/api/groups/{group_id}/members")
async def list_group_members(group_id: int, token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id, username, role, is_active FROM users WHERE group_id = ? ORDER BY username", (group_id,))
    members = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"members": members}

# ==================== 目录 API ====================

@app.get("/api/folders")
async def list_folders(
    parent_id: Optional[int] = None,
    token_data: dict = Depends(verify_token)
):
    conn = get_db()
    c = conn.cursor()
    
    user_id = token_data.get("user_id")
    
    if parent_id is None:
        parent_id = 1
    
    # 管理员可以看到所有目录
    if token_data.get("role") == "admin":
        c.execute("""SELECT f.*, u.username as creator_name,
                    (SELECT COUNT(*) FROM documents WHERE folder_id = f.id AND is_active = 1) as doc_count,
                    (SELECT COALESCE(SUM(file_size), 0) FROM documents WHERE folder_id = f.id AND is_active = 1) as total_size
                    FROM folders f 
                    LEFT JOIN users u ON f.created_by = u.username
                    WHERE f.parent_id = ? AND f.is_active = 1 
                    ORDER BY f.name""", (parent_id,))
    else:
        # 普通用户只能看到有权限的目录
        accessible_ids = get_user_accessible_folder_ids(user_id, conn)
        if not accessible_ids:
            conn.close()
            return {"folders": []}
        
        placeholders = ','.join(['?' for _ in accessible_ids])
        c.execute(f"""SELECT f.*, u.username as creator_name,
                    (SELECT COUNT(*) FROM documents WHERE folder_id = f.id AND is_active = 1) as doc_count,
                    (SELECT COALESCE(SUM(file_size), 0) FROM documents WHERE folder_id = f.id AND is_active = 1) as total_size
                    FROM folders f 
                    LEFT JOIN users u ON f.created_by = u.username
                    WHERE f.parent_id = ? AND f.is_active = 1 AND f.id IN ({placeholders})
                    ORDER BY f.name""", [parent_id] + accessible_ids)
    
    folders = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"folders": folders}

@app.post("/api/folders")
async def create_folder(folder: FolderCreate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建目录")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder.parent_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="父目录不存在")
    
    c.execute("SELECT id FROM folders WHERE name = ? AND parent_id = ? AND is_active = 1",
              (folder.name, folder.parent_id))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="同级目录下已存在同名目录")
    
    c.execute("INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)",
              (folder.name, folder.parent_id, token_data["username"]))
    folder_id = c.lastrowid
    
    # 记录审计日志
    log_audit(conn, token_data.get("user_id"), token_data["username"],
              "CREATE_FOLDER", "folder", folder_id, folder.name, None, None)
    conn.commit()
    conn.close()
    
    return {"folder_id": folder_id, "message": "目录创建成功"}

@app.put("/api/folders/{folder_id}")
async def rename_folder(folder_id: int, folder_update: FolderUpdate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以重命名目录")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id, parent_id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    folder = c.fetchone()
    if not folder:
        conn.close()
        raise HTTPException(status_code=404, detail="目录不存在")
    
    if folder_id == 1:
        conn.close()
        raise HTTPException(status_code=400, detail="不能重命名根目录")
    
    c.execute("SELECT id FROM folders WHERE name = ? AND parent_id = ? AND id != ? AND is_active = 1",
              (folder_update.name, folder["parent_id"], folder_id))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="同级目录下已存在同名目录")
    
    c.execute("UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              (folder_update.name, folder_id))
    conn.commit()
    conn.close()
    
    return {"message": "目录重命名成功"}

@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: int, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除目录")
    
    if folder_id == 1:
        raise HTTPException(status_code=400, detail="不能删除根目录")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目录不存在")
    
    # 记录审计日志
    log_audit(conn, token_data.get("user_id"), token_data["username"],
              "DELETE_FOLDER", "folder", folder_id, None, None, None)
    
    c.execute("UPDATE documents SET folder_id = 1 WHERE folder_id = ?", (folder_id,))
    c.execute("UPDATE folders SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (folder_id,))
    conn.commit()
    conn.close()
    
    return {"message": "目录删除成功"}

# ==================== 文档 API ====================

@app.get("/api/documents")
async def list_documents(
    folder_id: Optional[int] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = "uploaded_at",
    sort_order: Optional[str] = "desc",
    token_data: dict = Depends(verify_token)
):
    conn = get_db()
    c = conn.cursor()
    
    user_id = token_data.get("user_id")
    
    # 管理员可以看到所有文档
    if token_data.get("role") == "admin":
        query = """SELECT d.*, u.username as uploader_name 
                   FROM documents d 
                   LEFT JOIN users u ON d.uploaded_by = u.username
                   WHERE d.is_active = 1"""
        params = []
    else:
        # 普通用户只能看到有权限的文档
        accessible_folder_ids = get_user_accessible_folder_ids(user_id, conn)
        
        query = """SELECT d.*, u.username as uploader_name 
                   FROM documents d 
                   LEFT JOIN users u ON d.uploaded_by = u.username
                   WHERE d.is_active = 1"""
        params = []
        
        # 如果没有目录权限，检查直接文档权限
        if not accessible_folder_ids:
            query += f""" AND (d.id IN (SELECT document_id FROM user_document_permissions WHERE user_id = ? AND can_read = 1)
                         OR d.id IN (SELECT document_id FROM group_document_permissions 
                                     WHERE group_id = (SELECT group_id FROM users WHERE id = ?) AND can_read = 1))"""
            params.extend([user_id, user_id])
    
    if folder_id is not None:
        query += " AND d.folder_id = ?"
        params.append(folder_id)
    
    if search:
        query += " AND d.original_name LIKE ?"
        params.append(f"%{search}%")
    
    valid_sort_fields = ["original_name", "file_size", "uploaded_at", "updated_at"]
    if sort_by in valid_sort_fields:
        query += f" ORDER BY d.{sort_by}"
        if sort_order.lower() == "asc":
            query += " ASC"
        else:
            query += " DESC"
    else:
        query += " ORDER BY d.uploaded_at DESC"
    
    c.execute(query, params)
    documents = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"documents": documents}

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    folder_id: int = Query(default=1),
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以上传文档")
    
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持 PDF 文件")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    # 限制文件大小（50MB）
    MAX_FILE_SIZE = 50 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="文件过大，最大支持 50MB")
    
    file_hash = hashlib.md5(f"{file.filename}{datetime.now()}".encode()).hexdigest()
    filename = f"{file_hash}.pdf"
    file_path = UPLOAD_DIR / filename
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    c.execute("INSERT INTO documents (filename, original_name, file_size, folder_id, uploaded_by) VALUES (?, ?, ?, ?, ?)",
              (filename, file.filename, len(content), folder_id, token_data["username"]))
    doc_id = c.lastrowid
    conn.commit()
    conn.close()
    
    return {"document_id": doc_id, "message": "上传成功"}

@app.get("/api/documents/{doc_id}/view")
async def view_document(doc_id: int, token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    
    user_id = token_data.get("user_id")
    
    # 检查权限
    if token_data.get("role") != "admin":
        if not check_document_permission(user_id, doc_id, conn):
            conn.close()
            raise HTTPException(status_code=403, detail="没有权限访问此文档")
    
    c.execute("SELECT filename, original_name FROM documents WHERE id = ? AND is_active = 1", (doc_id,))
    doc = c.fetchone()
    conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    
    file_path = UPLOAD_DIR / doc["filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    # 记录访问日志
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO access_logs (user_id, username, document_id, action, ip_address) VALUES (?, ?, ?, ?, ?)",
              (user_id, token_data["username"], doc_id, "view", "unknown"))
    conn.commit()
    conn.close()
    
    return FileResponse(path=str(file_path), media_type="application/pdf", filename=doc["original_name"])

@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: int, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除文档")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM documents WHERE id = ? AND is_active = 1", (doc_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="文档不存在")
    
    # 记录审计日志
    log_audit(conn, token_data.get("user_id"), token_data["username"],
              "DELETE_DOCUMENT", "document", doc_id, None, None, None)
    
    c.execute("UPDATE documents SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()
    
    return {"message": "文档删除成功"}

@app.post("/api/documents/batch-delete")
async def batch_delete_documents(batch: BatchDelete, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除文档")
    
    if not batch.document_ids:
        raise HTTPException(status_code=400, detail="请选择要删除的文档")
    
    conn = get_db()
    c = conn.cursor()
    
    placeholders = ','.join(['?' for _ in batch.document_ids])
    c.execute(f"UPDATE documents SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
              batch.document_ids)
    deleted_count = c.rowcount
    conn.commit()
    conn.close()
    
    return {"message": f"成功删除 {deleted_count} 个文档"}

@app.post("/api/documents/batch-move")
async def batch_move_documents(batch: BatchMove, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以移动文档")
    
    if not batch.document_ids:
        raise HTTPException(status_code=400, detail="请选择要移动的文档")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (batch.folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    placeholders = ','.join(['?' for _ in batch.document_ids])
    c.execute(f"UPDATE documents SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
              [batch.folder_id] + batch.document_ids)
    moved_count = c.rowcount
    conn.commit()
    conn.close()
    
    return {"message": f"成功移动 {moved_count} 个文档"}

@app.put("/api/documents/{doc_id}/move")
async def move_document(doc_id: int, move: DocumentMove, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以移动文档")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM documents WHERE id = ? AND is_active = 1", (doc_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="文档不存在")
    
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (move.folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    c.execute("UPDATE documents SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              (move.folder_id, doc_id))
    conn.commit()
    conn.close()
    
    return {"message": "文档移动成功"}

# ==================== 权限 API ====================

@app.get("/api/permissions/{target_type}/{target_id}")
async def get_permissions(target_type: str, target_id: int, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    if target_type == "user":
        # 获取用户的目录权限
        c.execute("""SELECT fp.folder_id, f.name as folder_name, fp.can_read
                    FROM user_folder_permissions fp
                    JOIN folders f ON fp.folder_id = f.id
                    WHERE fp.user_id = ?""", (target_id,))
        folder_permissions = [dict(row) for row in c.fetchall()]
        
        # 获取用户的文档权限
        c.execute("""SELECT dp.document_id, d.original_name as document_name, dp.can_read
                    FROM user_document_permissions dp
                    JOIN documents d ON dp.document_id = d.id
                    WHERE dp.user_id = ?""", (target_id,))
        document_permissions = [dict(row) for row in c.fetchall()]
        
    elif target_type == "group":
        # 获取用户组的目录权限
        c.execute("""SELECT fp.folder_id, f.name as folder_name, fp.can_read
                    FROM group_folder_permissions fp
                    JOIN folders f ON fp.folder_id = f.id
                    WHERE fp.group_id = ?""", (target_id,))
        folder_permissions = [dict(row) for row in c.fetchall()]
        
        # 获取用户组的文档权限
        c.execute("""SELECT dp.document_id, d.original_name as document_name, dp.can_read
                    FROM group_document_permissions dp
                    JOIN documents d ON dp.document_id = d.id
                    WHERE dp.group_id = ?""", (target_id,))
        document_permissions = [dict(row) for row in c.fetchall()]
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="无效的目标类型")
    
    conn.close()
    
    return {
        "folder_permissions": folder_permissions,
        "document_permissions": document_permissions
    }

@app.post("/api/permissions")
async def set_permission(permission: PermissionCreate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以设置权限")
    
    conn = get_db()
    c = conn.cursor()
    
    if permission.resource_type == "folder":
        if permission.target_type == "user":
            c.execute("""INSERT OR REPLACE INTO user_folder_permissions (user_id, folder_id, can_read)
                        VALUES (?, ?, ?)""",
                     (permission.target_id, permission.resource_id, 1 if permission.can_read else 0))
        elif permission.target_type == "group":
            c.execute("""INSERT OR REPLACE INTO group_folder_permissions (group_id, folder_id, can_read)
                        VALUES (?, ?, ?)""",
                     (permission.target_id, permission.resource_id, 1 if permission.can_read else 0))
    elif permission.resource_type == "document":
        if permission.target_type == "user":
            c.execute("""INSERT OR REPLACE INTO user_document_permissions (user_id, document_id, can_read)
                        VALUES (?, ?, ?)""",
                     (permission.target_id, permission.resource_id, 1 if permission.can_read else 0))
        elif permission.target_type == "group":
            c.execute("""INSERT OR REPLACE INTO group_document_permissions (group_id, document_id, can_read)
                        VALUES (?, ?, ?)""",
                     (permission.target_id, permission.resource_id, 1 if permission.can_read else 0))
    
    # 记录审计日志
    action_type = "GRANT" if permission.can_read else "REVOKE"
    log_audit(conn, token_data.get("user_id"), token_data["username"],
              f"{action_type}_PERMISSION", permission.resource_type, 
              permission.resource_id, None,
              f"目标: {permission.target_type}#{permission.target_id}", None)
    
    conn.commit()
    conn.close()
    
    return {"message": "权限设置成功"}

class BatchPermissionItem(BaseModel):
    resource_type: str
    resource_id: int
    can_read: bool = True

class BatchPermissionRequest(BaseModel):
    target_type: str
    target_id: int
    items: List[BatchPermissionItem]

@app.post("/api/permissions/batch")
async def batch_set_permissions(
    batch: BatchPermissionRequest,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以设置权限")
    
    conn = get_db()
    c = conn.cursor()
    
    success_count = 0
    for item in batch.items:
        if item.resource_type == "folder":
            if batch.target_type == "user":
                c.execute("""INSERT OR REPLACE INTO user_folder_permissions (user_id, folder_id, can_read)
                            VALUES (?, ?, ?)""",
                         (batch.target_id, item.resource_id, 1 if item.can_read else 0))
            elif batch.target_type == "group":
                c.execute("""INSERT OR REPLACE INTO group_folder_permissions (group_id, folder_id, can_read)
                            VALUES (?, ?, ?)""",
                         (batch.target_id, item.resource_id, 1 if item.can_read else 0))
        elif item.resource_type == "document":
            if batch.target_type == "user":
                c.execute("""INSERT OR REPLACE INTO user_document_permissions (user_id, document_id, can_read)
                            VALUES (?, ?, ?)""",
                         (batch.target_id, item.resource_id, 1 if item.can_read else 0))
            elif batch.target_type == "group":
                c.execute("""INSERT OR REPLACE INTO group_document_permissions (group_id, document_id, can_read)
                            VALUES (?, ?, ?)""",
                         (batch.target_id, item.resource_id, 1 if item.can_read else 0))
        success_count += 1
    
    conn.commit()
    conn.close()
    
    return {"message": f"成功设置 {success_count} 个权限"}

@app.get("/api/search/users-and-groups")
async def search_users_and_groups(
    q: str = Query(default=""),
    token_data: dict = Depends(verify_token)
):
    """模糊搜索用户和用户组"""
    conn = get_db()
    c = conn.cursor()
    
    # 搜索用户
    c.execute("""SELECT id, username as name, 'user' as type 
                FROM users WHERE username LIKE ? AND is_active = 1 LIMIT 10""",
              (f"%{q}%",))
    users = [dict(row) for row in c.fetchall()]
    
    # 搜索用户组
    c.execute("""SELECT id, name, 'group' as type 
                FROM user_groups WHERE name LIKE ? LIMIT 10""",
              (f"%{q}%",))
    groups = [dict(row) for row in c.fetchall()]
    
    conn.close()
    
    return {"results": users + groups}

@app.delete("/api/permissions/{target_type}/{target_id}/{resource_type}/{resource_id}")
async def remove_permission(
    target_type: str, target_id: int, resource_type: str, resource_id: int,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除权限")
    
    conn = get_db()
    c = conn.cursor()
    
    if resource_type == "folder":
        if target_type == "user":
            c.execute("DELETE FROM user_folder_permissions WHERE user_id = ? AND folder_id = ?",
                     (target_id, resource_id))
        elif target_type == "group":
            c.execute("DELETE FROM group_folder_permissions WHERE group_id = ? AND folder_id = ?",
                     (target_id, resource_id))
    elif resource_type == "document":
        if target_type == "user":
            c.execute("DELETE FROM user_document_permissions WHERE user_id = ? AND document_id = ?",
                     (target_id, resource_id))
        elif target_type == "group":
            c.execute("DELETE FROM group_document_permissions WHERE group_id = ? AND document_id = ?",
                     (target_id, resource_id))
    
    conn.commit()
    conn.close()
    
    return {"message": "权限删除成功"}

# ==================== 其他 API ====================

@app.post("/api/fingerprint")
async def register_fingerprint(fingerprint: DeviceFingerprint, request: Request, token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    ip_address = request.client.host
    
    c.execute("""INSERT OR REPLACE INTO device_fingerprints 
                (fingerprint_hash, username, last_seen, ip_address, user_agent, 
                 canvas_fingerprint, webgl_info, screen_info, timezone, language)
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)""",
              (fingerprint.fingerprint_hash, token_data["username"], ip_address,
               fingerprint.user_agent, fingerprint.canvas_fingerprint,
               json.dumps(fingerprint.webgl_info), json.dumps(fingerprint.screen_info),
               fingerprint.timezone, fingerprint.language))
    conn.commit()
    conn.close()
    
    return {"message": "指纹已记录"}

@app.post("/api/access-log")
async def log_access(log: AccessLog, request: Request, token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    
    # 获取真实 IP 地址（考虑反向代理）
    ip_address = request.headers.get("X-Real-IP") or                  request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or                  request.client.host or "unknown"
    
    # 如果 IP 是 localhost 或内网地址，尝试获取真实 IP
    if ip_address in ("127.0.0.1", "localhost", ""):
        ip_address = request.client.host or "unknown"
    
    user_agent = request.headers.get("user-agent", "")
    
    from datetime import timedelta
    beijing_time = datetime.now(timezone(timedelta(hours=8)))
    
    c.execute("""INSERT INTO access_logs 
                (user_id, username, document_id, action, page_number, 
                 device_fingerprint, ip_address, user_agent, duration_seconds, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
              (token_data.get("user_id"), token_data["username"], log.document_id,
               log.action, log.page_number, log.device_fingerprint, ip_address,
               user_agent, log.duration_seconds, beijing_time.strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    conn.close()
    
    return {"message": "日志已记录"}

# ==================== 管理员 API ====================

@app.get("/api/admin/logs")
async def get_access_logs(page: int = 1, limit: int = 50, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    offset = (page - 1) * limit
    c.execute("""SELECT al.*, d.original_name, d.folder_id
                FROM access_logs al 
                LEFT JOIN documents d ON al.document_id = d.id 
                ORDER BY al.timestamp DESC 
                LIMIT ? OFFSET ?""", (limit, offset))
    logs = []
    for row in c.fetchall():
        log = dict(row)
        log["file_path"] = get_file_path(conn, log["document_id"]) if log["document_id"] else ""
        logs.append(log)
    
    c.execute("SELECT COUNT(*) as total FROM access_logs")
    total = c.fetchone()["total"]
    
    conn.close()
    return {"logs": logs, "total": total, "page": page, "limit": limit}

@app.get("/api/admin/audit-logs")
async def get_audit_logs(
    page: int = 1,
    limit: int = 50,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    offset = (page - 1) * limit
    c.execute("""SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?""",
              (limit, offset))
    logs = [dict(row) for row in c.fetchall()]
    
    c.execute("SELECT COUNT(*) as total FROM audit_logs")
    total = c.fetchone()["total"]
    
    conn.close()
    return {"logs": logs, "total": total, "page": page, "limit": limit}

@app.get("/api/admin/fingerprints")
async def get_fingerprints(token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM device_fingerprints ORDER BY last_seen DESC")
    fingerprints = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"fingerprints": fingerprints}

@app.get("/api/admin/users")
async def get_users(token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    c.execute("""SELECT u.id, u.username, u.role, u.group_id, u.is_active, 
                u.created_at, u.updated_at, u.last_login,
                g.name as group_name
                FROM users u
                LEFT JOIN user_groups g ON u.group_id = g.id
                ORDER BY u.id""")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"users": users}

@app.put("/api/admin/users/{user_id}")
async def update_user(user_id: int, user_update: UserUpdate, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="用户不存在")
    
    updates = []
    params = []
    
    if user_update.username is not None:
        if "username" not in ALLOWED_USER_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("username = ?")
        params.append(user_update.username)
    
    if user_update.password is not None:
        if "password_hash" not in ALLOWED_USER_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("password_hash = ?")
        params.append(hash_password(user_update.password))
    
    if user_update.role is not None:
        if "role" not in ALLOWED_USER_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("role = ?")
        params.append(user_update.role)
    
    if user_update.group_id is not None:
        if "group_id" not in ALLOWED_USER_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("group_id = ?")
        params.append(user_update.group_id)
    
    if user_update.is_active is not None:
        if "is_active" not in ALLOWED_USER_UPDATE_FIELDS:
            raise HTTPException(status_code=400, detail="非法字段")
        updates.append("is_active = ?")
        params.append(1 if user_update.is_active else 0)
    
    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        c.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    
    conn.close()
    return {"message": "用户更新成功"}

@app.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: int, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="用户不存在")
    
    if user["username"] == token_data["username"]:
        conn.close()
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    # 记录审计日志
    log_audit(conn, token_data.get("user_id"), token_data["username"], 
              "DELETE_USER", "user", user_id, user["username"], 
              f"删除用户 {user[username]}", None)
    
    c.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    
    return {"message": "用户删除成功"}

@app.post("/api/logout")
async def logout():
    """退出登录，清除 Cookie"""
    from fastapi.responses import JSONResponse
    response = JSONResponse(content={"message": "已退出登录"})
    response.delete_cookie(key="auth_token")
    return response

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
