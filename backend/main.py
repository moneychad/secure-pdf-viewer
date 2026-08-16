"""
安全文档共享平台 - 后端服务
方案B：Canvas渲染 + 设备指纹 + 隐形水印
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

# 数据库初始化
def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    
    # 用户表
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'viewer',
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
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

# Pydantic 模型
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

class ChangePassword(BaseModel):
    old_password: str
    new_password: str

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

# 工具函数
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(username: str, role: str) -> str:
    payload = {
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc).timestamp() + 86400  # 24小时
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
    
    # 更新最后登录时间
    c.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user_data["id"],))
    conn.commit()
    conn.close()
    
    token = create_token(user_data["username"], user_data["role"])
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
        c.execute("INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)",
                  (user.username, password_hash, user.role, 1))
        conn.commit()
        conn.close()
        return {"message": "用户创建成功"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已存在")

@app.post("/api/change-password")
async def change_password(
    passwords: ChangePassword,
    token_data: dict = Depends(verify_token)
):
    conn = get_db()
    c = conn.cursor()
    
    # 验证旧密码
    old_hash = hash_password(passwords.old_password)
    c.execute("SELECT id FROM users WHERE username = ? AND password_hash = ?",
              (token_data["username"], old_hash))
    
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="旧密码错误")
    
    # 更新密码
    new_hash = hash_password(passwords.new_password)
    c.execute("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
              (new_hash, token_data["username"]))
    conn.commit()
    conn.close()
    
    return {"message": "密码修改成功"}

# ==================== 目录 API ====================

@app.get("/api/folders")
async def list_folders(
    parent_id: Optional[int] = None,
    token_data: dict = Depends(verify_token)
):
    conn = get_db()
    c = conn.cursor()
    
    if parent_id is None:
        c.execute("""SELECT f.*, u.username as creator_name,
                    (SELECT COUNT(*) FROM documents WHERE folder_id = f.id AND is_active = 1) as doc_count,
                    (SELECT COALESCE(SUM(file_size), 0) FROM documents WHERE folder_id = f.id AND is_active = 1) as total_size
                    FROM folders f 
                    LEFT JOIN users u ON f.created_by = u.username
                    WHERE f.parent_id = 1 AND f.is_active = 1 
                    ORDER BY f.name""")
    else:
        c.execute("""SELECT f.*, u.username as creator_name,
                    (SELECT COUNT(*) FROM documents WHERE folder_id = f.id AND is_active = 1) as doc_count,
                    (SELECT COALESCE(SUM(file_size), 0) FROM documents WHERE folder_id = f.id AND is_active = 1) as total_size
                    FROM folders f 
                    LEFT JOIN users u ON f.created_by = u.username
                    WHERE f.parent_id = ? AND f.is_active = 1 
                    ORDER BY f.name""", (parent_id,))
    
    folders = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"folders": folders}

@app.post("/api/folders")
async def create_folder(
    folder: FolderCreate,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建目录")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查父目录是否存在
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder.parent_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="父目录不存在")
    
    # 检查同级目录名是否重复
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
async def rename_folder(
    folder_id: int,
    folder_update: FolderUpdate,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以重命名目录")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查目录是否存在
    c.execute("SELECT id, parent_id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    folder = c.fetchone()
    if not folder:
        conn.close()
        raise HTTPException(status_code=404, detail="目录不存在")
    
    # 不能重命名根目录
    if folder_id == 1:
        conn.close()
        raise HTTPException(status_code=400, detail="不能重命名根目录")
    
    # 检查同级目录名是否重复
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
async def delete_folder(
    folder_id: int,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除目录")
    
    if folder_id == 1:
        raise HTTPException(status_code=400, detail="不能删除根目录")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查目录是否存在
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目录不存在")
    
    # 将目录下的文档移到根目录
    c.execute("UPDATE documents SET folder_id = 1 WHERE folder_id = ?", (folder_id,))
    
    # 软删除目录
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
    
    # 构建查询
    query = """SELECT d.*, u.username as uploader_name 
               FROM documents d 
               LEFT JOIN users u ON d.uploaded_by = u.username
               WHERE d.is_active = 1"""
    params = []
    
    if folder_id is not None:
        query += " AND d.folder_id = ?"
        params.append(folder_id)
    
    if search:
        query += " AND d.original_name LIKE ?"
        params.append(f"%{search}%")
    
    # 排序
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
    
    # 检查目录是否存在
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    # 生成唯一文件名
    file_hash = hashlib.md5(f"{file.filename}{datetime.now()}".encode()).hexdigest()
    filename = f"{file_hash}.pdf"
    file_path = UPLOAD_DIR / filename
    
    # 保存文件
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # 记录到数据库
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
              (token_data.get("user_id"), token_data["username"], doc_id, "view", "unknown"))
    conn.commit()
    conn.close()
    
    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=doc["original_name"]
    )

@app.delete("/api/documents/{doc_id}")
async def delete_document(
    doc_id: int,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除文档")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查文档是否存在
    c.execute("SELECT id, filename FROM documents WHERE id = ? AND is_active = 1", (doc_id,))
    doc = c.fetchone()
    if not doc:
        conn.close()
        raise HTTPException(status_code=404, detail="文档不存在")
    
    # 软删除文档
    c.execute("UPDATE documents SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()
    
    return {"message": "文档删除成功"}

@app.post("/api/documents/batch-delete")
async def batch_delete_documents(
    batch: BatchDelete,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除文档")
    
    if not batch.document_ids:
        raise HTTPException(status_code=400, detail="请选择要删除的文档")
    
    conn = get_db()
    c = conn.cursor()
    
    # 批量软删除
    placeholders = ','.join(['?' for _ in batch.document_ids])
    c.execute(f"UPDATE documents SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
              batch.document_ids)
    deleted_count = c.rowcount
    conn.commit()
    conn.close()
    
    return {"message": f"成功删除 {deleted_count} 个文档"}

@app.post("/api/documents/batch-move")
async def batch_move_documents(
    batch: BatchMove,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以移动文档")
    
    if not batch.document_ids:
        raise HTTPException(status_code=400, detail="请选择要移动的文档")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查目标目录是否存在
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (batch.folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    # 批量移动
    placeholders = ','.join(['?' for _ in batch.document_ids])
    c.execute(f"UPDATE documents SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})",
              [batch.folder_id] + batch.document_ids)
    moved_count = c.rowcount
    conn.commit()
    conn.close()
    
    return {"message": f"成功移动 {moved_count} 个文档"}

@app.put("/api/documents/{doc_id}/move")
async def move_document(
    doc_id: int,
    move: DocumentMove,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以移动文档")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查文档是否存在
    c.execute("SELECT id FROM documents WHERE id = ? AND is_active = 1", (doc_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="文档不存在")
    
    # 检查目标目录是否存在
    c.execute("SELECT id FROM folders WHERE id = ? AND is_active = 1", (move.folder_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标目录不存在")
    
    c.execute("UPDATE documents SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              (move.folder_id, doc_id))
    conn.commit()
    conn.close()
    
    return {"message": "文档移动成功"}

# ==================== 其他 API ====================

@app.post("/api/fingerprint")
async def register_fingerprint(
    fingerprint: DeviceFingerprint,
    request: Request,
    token_data: dict = Depends(verify_token)
):
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
async def log_access(
    log: AccessLog,
    request: Request,
    token_data: dict = Depends(verify_token)
):
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
async def get_access_logs(
    page: int = 1,
    limit: int = 50,
    token_data: dict = Depends(verify_token)
):
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
    c.execute("SELECT id, username, role, is_active, created_at, updated_at, last_login FROM users ORDER BY id")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"users": users}

@app.put("/api/admin/users/{user_id}")
async def update_user(
    user_id: int,
    user_update: UserUpdate,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    conn = get_db()
    c = conn.cursor()
    
    # 检查用户是否存在
    c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 构建更新语句
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
    
    if user_update.is_active is not None:
        updates.append("is_active = ?")
        params.append(1 if user_update.is_active else 0)
    
    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        
        sql = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
        c.execute(sql, params)
        conn.commit()
    
    conn.close()
    return {"message": "用户更新成功"}

@app.delete("/api/admin/users/{user_id}")
async def delete_user(
    user_id: int,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="无权限")
    
    # 不能删除自己
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
