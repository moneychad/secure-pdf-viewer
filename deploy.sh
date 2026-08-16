#!/bin/bash
# 安全文档共享平台 - 部署脚本

set -e

echo "=== 安全文档共享平台 部署脚本 ==="

# 1. 安装 Git
echo "[1/8] 安装 Git..."
sudo apt-get install -y git

# 2. 创建项目目录
echo "[2/8] 创建项目目录..."
sudo mkdir -p /opt/secure-pdf-viewer/{backend/{uploads,logs},frontend/{css,js,assets}}
sudo chown -R hope:hope /opt/secure-pdf-viewer

# 3. 初始化 Git 仓库
echo "[3/8] 初始化 Git 仓库..."
cd /opt/secure-pdf-viewer
git init
git config user.email "admin@company.com"
git config user.name "Secure PDF Platform"

# 4. 创建 Python 虚拟环境
echo "[4/8] 创建 Python 虚拟环境..."
cd /opt/secure-pdf-viewer/backend
python3 -m venv venv
source venv/bin/activate

# 5. 安装 Python 依赖
echo "[5/8] 安装 Python 依赖..."
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn -r requirements.txt

# 6. 配置 Nginx
echo "[6/8] 配置 Nginx..."
sudo cp /opt/secure-pdf-viewer/nginx/secure-pdf-viewer.conf /etc/nginx/sites-available/secure-pdf-viewer
sudo ln -sf /etc/nginx/sites-available/secure-pdf-viewer /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 7. 创建 systemd 服务
echo "[7/8] 创建 systemd 服务..."
sudo tee /etc/systemd/system/secure-pdf-viewer.service > /dev/null <<EOF
[Unit]
Description=Secure PDF Viewer Backend
After=network.target

[Service]
Type=simple
User=hope
WorkingDirectory=/opt/secure-pdf-viewer/backend
Environment="PATH=/opt/secure-pdf-viewer/backend/venv/bin"
ExecStart=/opt/secure-pdf-viewer/backend/venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable secure-pdf-viewer
sudo systemctl start secure-pdf-viewer

# 8. Git 初始提交
echo "[8/8] Git 初始提交..."
cd /opt/secure-pdf-viewer
git add .
git commit -m "Initial commit: 安全文档共享平台"

echo ""
echo "=== 部署完成! ==="
echo ""
echo "访问地址: http://192.168.100.107"
echo "默认管理员: admin / admin123"
echo ""
echo "请立即修改默认密码!"
echo ""
echo "常用命令:"
echo "  查看后端状态: sudo systemctl status secure-pdf-viewer"
echo "  查看后端日志: sudo journalctl -u secure-pdf-viewer -f"
echo "  重启后端: sudo systemctl restart secure-pdf-viewer"
echo "  查看 Nginx 日志: sudo tail -f /var/log/nginx/error.log"
echo ""
