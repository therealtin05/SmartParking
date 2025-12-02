# 📁 Hướng Dẫn Tổ Chức Lại Folder & Update GitHub ( 20/11/2025)

## 🎯 Mục Tiêu

Tổ chức lại cấu trúc folder từ cấu trúc lồng nhau phức tạp thành cấu trúc rõ ràng, dễ quản lý.

---

## 📊 CẤU TRÚC HIỆN TẠI (Cần Sửa)

```
D:\SmartParking\
├── package.json (dependencies chung)
├── SmartParking\
│   ├── package.json (config tools)
│   ├── step_by_step.md
│   ├── pipeline_*.md
│   └── Smart_Parking\  ← React app ở đây (quá sâu!)
│       ├── src\
│       └── ...
```

**Vấn đề**: Quá nhiều cấp lồng nhau, khó quản lý!

---

## ✨ CẤU TRÚC ĐỀ XUẤT (Sau Khi Reorganize)

```
D:\SmartParking\
│
├── 📁 frontend\                    ← React app (di chuyển từ Smart_Parking)
│   ├── src\
│   ├── public\
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── ...
│
├── 📁 docs\                        ← Tất cả tài liệu
│   ├── step_by_step.md
│   ├── pipeline_tong_quat.md
│   ├── pipeline_chi_tiet.md
│   └── prompt.txt
│
├── 📁 scripts\                     ← Các file command/script
│   ├── Command.txt
│   └── CommandHoiCham.txt
│
├── 📄 package.json                 ← Root package.json (giữ dependencies chung)
├── 📄 package-lock.json
├── 📄 README.md                    ← README chính
├── 📄 .gitignore                   ← Git ignore file
└── 📄 LICENSE                      ← (nếu có)
```

---

## 🚀 CÁC BƯỚC THỰC HIỆN

### **BƯỚC 1: Backup Project (QUAN TRỌNG!)**

```powershell
# Tạo backup trước khi reorganize
cd D:\
xcopy SmartParking SmartParking_backup /E /I /H
```

### **BƯỚC 2: Tạo Cấu Trúc Folder Mới**

```powershell
cd D:\SmartParking

# Tạo các folder mới
mkdir frontend
mkdir docs
mkdir scripts
```

### **BƯỚC 3: Di Chuyển React App**

```powershell
# Di chuyển toàn bộ React app từ SmartParking\Smart_Parking\ sang frontend\
xcopy SmartParking\Smart_Parking\* frontend\ /E /I /H /Y

# Xóa folder cũ (sau khi đã kiểm tra)
rmdir SmartParking\Smart_Parking /S /Q
```

### **BƯỚC 4: Di Chuyển Tài Liệu**

```powershell
# Di chuyển các file markdown
move SmartParking\step_by_step.md docs\
move SmartParking\pipeline_tong_quat.md docs\
move SmartParking\pipeline_chi_tiet.md docs\
move SmartParking\pipeline_tong_quat.txt docs\
move SmartParking\prompt.txt docs\
```

### **BƯỚC 5: Di Chuyển Scripts/Commands**

```powershell
# Di chuyển các file command
move SmartParking\Command.txt scripts\
move CommandHoiCham.txt scripts\
```

### **BƯỚC 6: Xử Lý package.json**

**Option A: Giữ package.json ở root (cho dependencies chung)**
- Giữ nguyên `D:\SmartParking\package.json` (có firebase, chart.js)
- Giữ `frontend\package.json` (cho React app)

**Option B: Chỉ giữ package.json trong frontend**
- Xóa `D:\SmartParking\package.json`
- Merge dependencies vào `frontend\package.json` nếu cần

**Khuyến nghị**: Chọn **Option A** nếu bạn muốn có workspace chung.

### **BƯỚC 7: Xóa Folder SmartParking Cũ (Sau Khi Đã Di Chuyển Hết)**

```powershell
# Kiểm tra lại xem còn file gì trong SmartParking không
dir SmartParking

# Nếu chỉ còn node_modules và package.json, có thể xóa
rmdir SmartParking /S /Q
```

### **BƯỚC 8: Tạo/Cập Nhật .gitignore**

Tạo file `.gitignore` ở **root** (thư mục gốc `D:\SmartParking\`):

```gitignore
# Dependencies
node_modules/
package-lock.json

# Build outputs
dist/
build/
*.log

# Environment variables
.env
.env.local
.env.production

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Frontend specific
frontend/node_modules/
frontend/dist/
frontend/.vite/
```

### **BƯỚC 9: Cập Nhật README.md**

Tạo/cập nhật `README.md` ở root với nội dung:

```markdown
# Smart Parking System 🚗

Hệ thống quản lý bãi đỗ xe thông minh sử dụng AI/Computer Vision.

## 📁 Cấu Trúc Project

- `frontend/` - React + TypeScript + Vite application
- `docs/` - Tài liệu và hướng dẫn
- `scripts/` - Scripts và commands

## 🚀 Quick Start

### Frontend
\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

## 📚 Tài Liệu

Xem thêm trong folder `docs/`:
- `step_by_step.md` - Hướng dẫn từng bước
- `pipeline_tong_quat.md` - Pipeline tổng quát
```

---

## 📤 HƯỚNG DẪN UPDATE LÊN GITHUB

### **BƯỚC 1: Kiểm Tra Git Status**

```powershell
cd D:\SmartParking
git status
```

### **BƯỚC 2: Kiểm Tra Remote Repository**

```powershell
# Xem remote hiện tại
git remote -v

# Nếu chưa có remote, thêm remote
git remote add origin https://github.com/katherinenggit/SmartParking.git
```

### **BƯỚC 3: Add Tất Cả Thay Đổi**

```powershell
# Add tất cả file mới và thay đổi
git add .

# Hoặc add từng phần
git add frontend/
git add docs/
git add scripts/
git add README.md
git add .gitignore
```

### **BƯỚC 4: Commit Thay Đổi**

```powershell
# Commit với message mô tả rõ ràng
git commit -m "Reorganize folder structure: move React app to frontend/, docs to docs/, scripts to scripts/"
```

### **BƯỚC 5: Push Lên GitHub**

```powershell
# Push lên branch main (hoặc master)
git push origin main

# Nếu lần đầu push, có thể cần set upstream
git push -u origin main
```

### **BƯỚC 6: Xử Lý Nếu Có Conflict**

Nếu có conflict hoặc lỗi:

```powershell
# Pull trước để sync với remote
git pull origin main --rebase

# Sau đó push lại
git push origin main
```

### **BƯỚC 7: Kiểm Tra Trên GitHub**

1. Vào https://github.com/katherinenggit/SmartParking
2. Kiểm tra xem cấu trúc folder đã đúng chưa
3. Kiểm tra README.md có hiển thị đúng không

---

## ⚠️ LƯU Ý QUAN TRỌNG

1. **Backup trước**: Luôn backup project trước khi reorganize
2. **Kiểm tra đường dẫn**: Sau khi di chuyển, cần update các import path trong code
3. **Node modules**: Có thể cần xóa và cài lại `node_modules` sau khi reorganize
4. **Git history**: Nếu muốn giữ git history, dùng `git mv` thay vì `move`/`xcopy`

---

## 🔧 SCRIPT TỰ ĐỘNG (Optional)

Nếu muốn tự động hóa, tạo file `reorganize.ps1`:

```powershell
# reorganize.ps1
Write-Host "Starting reorganization..." -ForegroundColor Green

# Tạo folders
New-Item -ItemType Directory -Force -Path "frontend", "docs", "scripts"

# Di chuyển files
Move-Item -Path "SmartParking\Smart_Parking\*" -Destination "frontend\" -Force
Move-Item -Path "SmartParking\step_by_step.md" -Destination "docs\" -Force
# ... thêm các lệnh khác

Write-Host "Done! Please review the changes." -ForegroundColor Green
```

---

## ✅ CHECKLIST SAU KHI REORGANIZE

- [ ] Backup đã được tạo
- [ ] React app đã di chuyển vào `frontend/`
- [ ] Tài liệu đã di chuyển vào `docs/`
- [ ] Scripts đã di chuyển vào `scripts/`
- [ ] `.gitignore` đã được tạo/cập nhật
- [ ] `README.md` đã được cập nhật
- [ ] Đã test `npm run dev` trong `frontend/` vẫn chạy được
- [ ] Đã commit và push lên GitHub
- [ ] Đã kiểm tra trên GitHub web

---

## 🆘 NẾU GẶP VẤN ĐỀ

1. **Lỗi import path**: Tìm và thay thế các đường dẫn import trong code
2. **Lỗi dependencies**: Xóa `node_modules` và chạy `npm install` lại
3. **Git conflict**: Dùng `git pull --rebase` và resolve conflicts
4. **Mất file**: Kiểm tra trong `SmartParking_backup`

---

**Chúc bạn reorganize thành công! 🎉**

