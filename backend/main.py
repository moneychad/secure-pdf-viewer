"""
安全文档共享平台 - 后端服务
方案B：Canvas渲染 + 设备指纹 + 隐形水印
"""

import os
import json
import hashlib
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Request
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # 文档表
    c.execute('''CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size INTEGER,
        uploaded_by TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
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
    c.execute("INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)",
              (ADMIN_USERNAME, admin_hash, "admin"))
    
    conn.commit()
    conn.close()

init_db()

# Pydantic 模型
class UserLogin(BaseModel):
    username: str
    password: str

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
        "exp": datetime.utcnow().timestamp() + 86400  # 24小时
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

# API 路由
@app.post("/api/login")
async def login(user: UserLogin):
    conn = get_db()
    c = conn.cursor()
    
    password_hash = hash_password(user.password)
    c.execute("SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?",
              (user.username, password_hash))
    user_data = c.fetchone()
    conn.close()
    
    if not user_data:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    
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
async def register(user: UserLogin, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以创建用户")
    
    conn = get_db()
    c = conn.cursor()
    
    password_hash = hash_password(user.password)
    try:
        c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                  (user.username, password_hash))
        conn.commit()
        conn.close()
        return {"message": "用户创建成功"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已存在")

@app.get("/api/documents")
async def list_documents(token_data: dict = Depends(verify_token)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, filename, original_name, file_size, uploaded_by, uploaded_at FROM documents WHERE is_active = 1 ORDER BY uploaded_at DESC")
    documents = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"documents": documents}

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    token_data: dict = Depends(verify_token)
):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以上传文档")
    
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持 PDF 文件")
    
    # 生成唯一文件名
    file_hash = hashlib.md5(f"{file.filename}{datetime.now()}".encode()).hexdigest()
    filename = f"{file_hash}.pdf"
    file_path = UPLOAD_DIR / filename
    
    # 保存文件
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # 记录到数据库
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO documents (filename, original_name, file_size, uploaded_by) VALUES (?, ?, ?, ?)",
              (filename, file.filename, len(content), token_data["username"]))
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
    c.execute("SELECT id, username, role, created_at FROM users")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return {"users": users}

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
