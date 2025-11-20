# 🔧 Xử Lý Folder SmartParking\SmartParking

## 📋 Các File Cần Xử Lý

Trong `SmartParking\SmartParking\` có:
- ✅ `eslint.config.mts` - ESLint config với React plugin
- ✅ `package.json` - Có tailwindcss, prettier, react-router-dom
- ✅ `package-lock.json` - Lock file
- ✅ `node_modules/` - Dependencies đã cài
- ✅ `README.md` - File readme cũ

---

## 🎯 CÁCH XỬ LÝ

### **OPTION 1: Merge Vào Frontend (KHUYẾN NGHỊ)** ⭐

Vì các dependencies này (tailwindcss, react-router-dom) chủ yếu dùng cho frontend.

#### Bước 1: Merge Dependencies Vào Frontend

**File cần merge**: `SmartParking\SmartParking\package.json` → `frontend\package.json`

**Dependencies cần thêm vào frontend:**
- `react-router-dom: ^7.9.6` (đã có trong SmartParking/SmartParking)
- `tailwindcss: ^4.1.17` (devDependency)
- `prettier: 3.6.2` (devDependency)
- `autoprefixer: ^10.4.22` (devDependency)
- `postcss: ^8.5.6` (devDependency)
- `eslint-plugin-react: ^7.37.5` (devDependency - đã có trong frontend nhưng version khác)

#### Bước 2: Merge ESLint Config

**File**: `SmartParking\SmartParking\eslint.config.mts` → `frontend\eslint.config.js`

ESLint config trong SmartParking/SmartParking có `eslint-plugin-react` tốt hơn, nên merge vào.

#### Bước 3: Xóa Folder Cũ

Sau khi merge xong, xóa folder `SmartParking\SmartParking\`

---

### **OPTION 2: Giữ Ở Root (Nếu muốn workspace chung)**

Nếu bạn muốn giữ các tools (tailwindcss, prettier) ở root để dùng chung:

1. Merge `react-router-dom` vào `frontend/package.json`
2. Giữ `tailwindcss`, `prettier` ở root `package.json`
3. Di chuyển `eslint.config.mts` lên root
4. Xóa folder `SmartParking\SmartParking\`

---

## 📝 HƯỚNG DẪN CHI TIẾT (OPTION 1 - KHUYẾN NGHỊ)

### **BƯỚC 1: Backup**

```powershell
# Đã có backup rồi thì bỏ qua
```

### **BƯỚC 2: Merge package.json**

**File cần sửa**: `frontend\package.json`

**Thêm vào dependencies:**
```json
"react-router-dom": "^7.9.6"
```

**Thêm vào devDependencies:**
```json
"tailwindcss": "^4.1.17",
"autoprefixer": "^10.4.22",
"postcss": "^8.5.6",
"prettier": "3.6.2",
"eslint-plugin-react": "^7.37.5"
```

### **BƯỚC 3: Cập Nhật ESLint Config**

**File cần sửa**: `frontend\eslint.config.js`

Merge config từ `SmartParking\SmartParking\eslint.config.mts` vào `frontend\eslint.config.js`

### **BƯỚC 4: Xóa Folder Cũ**

```powershell
cd D:\SmartParking
rmdir SmartParking\SmartParking /S /Q
```

### **BƯỚC 5: Cài Lại Dependencies**

```powershell
cd frontend
rmdir node_modules /S /Q
del package-lock.json
npm install
```

---

## 🔍 SO SÁNH DEPENDENCIES

### SmartParking/SmartParking/package.json có:
- ✅ `react-router-dom` - **CẦN** cho frontend
- ✅ `tailwindcss` - **CẦN** cho styling
- ✅ `prettier` - **NÊN CÓ** cho code formatting
- ✅ `eslint-plugin-react` - **CẦN** cho ESLint React

### Frontend/package.json hiện có:
- ✅ React, Vite, TypeScript - OK
- ✅ ESLint cơ bản - OK nhưng thiếu React plugin tốt
- ❌ Thiếu react-router-dom
- ❌ Thiếu tailwindcss
- ❌ Thiếu prettier

---

## ✅ KẾT LUẬN

**Nên làm**: Merge tất cả vào `frontend/` vì:
1. Tất cả dependencies đều dùng cho frontend
2. Giữ mọi thứ trong một nơi dễ quản lý
3. Tránh duplicate dependencies

**Sau khi merge**: Xóa folder `SmartParking\SmartParking\` hoàn toàn.

