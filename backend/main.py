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
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import jwt
import uvicorn

# 配置
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    admin_hash = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
    c.execute("INSERT OR IGNORE INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)",
              (ADMIN_USERNAME, admin_hash, "admin", 1))
    
    # 创建默认根目录
    c.execute("INSERT OR IGNORE INTO folders (id, name, parent_id, created_by) VALUES (1, '根目录', NULL, 'system')")
    
    conn.commit()
    conn.close()

init_db()

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

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(username: str, role: str, user_id: int) -> str:
    payload = {
        "username": username,
        "role": role,
        "user_id": user_id,
        "exp": datetime.now(timezone.utc).timestamp() + 86400
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"])
        return payload
    except:
        raise HTTPException(status_code=401, detail="无效的认证令牌")

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def check_folder_permission(user_id: int, folder_id: int, db) -> bool:
    """检查用户是否有目录的读取权限（包括继承）"""
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
        return check_folder_permission(user_id, folder["parent_id"], db)
    
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

# ==================== 认证 API ====================

@app.post("/api/login")
async def login(user: UserLogin, request: Request):
    conn = get_db()
    c = conn.cursor()
    
    password_hash = hash_password(user.password)
    c.execute("SELECT id, username, role, is_active FROM users WHERE username = ? AND password_hash = ?",
              (user.username, password_hash))
    user_data = c.fetchone()
    
    if not user_data:
        conn.close()
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    
    if not user_data["is_active"]:
        conn.close()
        raise HTTPException(status_code=403, detail="账号已被停用，请联系管理员")
    
    c.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user_data["id"],))
    conn.commit()
    conn.close()
    
    token = create_token(user_data["username"], user_data["role"], user_data["id"])
    return {
        "token": token,
        "user": {
            "id": user_data["id"],
            "username": user_data["username"],
            "role": user_data["role"]
        }
    }

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
    
    old_hash = hash_password(passwords.old_password)
    c.execute("SELECT id FROM users WHERE username = ? AND password_hash = ?",
              (token_data["username"], old_hash))
    
    if not c.fetchone():
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
        updates.append("name = ?")
        params.append(group_update.name)
    
    if group_update.description is not None:
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
    
    file_hash = hashlib.md5(f"{file.filename}{datetime.now()}".encode()).hexdigest()
    filename = f"{file_hash}.pdf"
    file_path = UPLOAD_DIR / filename
    
    content = await file.read()
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
    
    conn.commit()
    conn.close()
    
    return {"message": "权限设置成功"}

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
    ip_address = request.client.host
    user_agent = request.headers.get("user-agent", "")
    
    c.execute("""INSERT INTO access_logs 
                (user_id, username, document_id, action, page_number, 
                 device_fingerprint, ip_address, user_agent, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
              (token_data.get("user_id"), token_data["username"], log.document_id,
               log.action, log.page_number, log.device_fingerprint, ip_address,
               user_agent, log.duration_seconds))
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
    c.execute("""SELECT al.*, d.original_name 
                FROM access_logs al 
                LEFT JOIN documents d ON al.document_id = d.id 
                ORDER BY al.timestamp DESC 
                LIMIT ? OFFSET ?""", (limit, offset))
    logs = [dict(row) for row in c.fetchall()]
    
    c.execute("SELECT COUNT(*) as total FROM access_logs")
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
        updates.append("username = ?")
        params.append(user_update.username)
    
    if user_update.password is not None:
        updates.append("password_hash = ?")
        params.append(hash_password(user_update.password))
    
    if user_update.role is not None:
        updates.append("role = ?")
        params.append(user_update.role)
    
    if user_update.group_id is not None:
        updates.append("group_id = ?")
        params.append(user_update.group_id)
    
    if user_update.is_active is not None:
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
    
    c.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    
    return {"message": "用户删除成功"}

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
