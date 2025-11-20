# 🔧 Fix Lỗi Tailwind CSS v4 với PostCSS

## ❌ Lỗi Gặp Phải

```
[plugin:vite:css] [postcss] It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin. 
The PostCSS plugin has moved to a separate package, so to continue using Tailwind CSS with PostCSS you'll 
need to install `@tailwindcss/postcss` and update your PostCSS configuration.
```

## 🔍 Nguyên Nhân

Tailwind CSS **v4** đã thay đổi cách hoạt động:
- **v3**: Dùng `tailwindcss` trực tiếp trong PostCSS config
- **v4**: Cần package riêng `@tailwindcss/postcss`

## ✅ Giải Pháp

### Đã Sửa:

1. ✅ **Cập nhật `postcss.config.js`**:
   - Thay `tailwindcss: {}` → `'@tailwindcss/postcss': {}`

2. ✅ **Thêm dependency vào `package.json`**:
   - Thêm `"@tailwindcss/postcss": "^4.1.17"`

### Cần Làm:

**Chạy lệnh này để cài package mới:**

```powershell
cd D:\SmartParking\frontend
npm install
```

Sau đó chạy lại:

```powershell
npm run dev
```

## 📝 Giải Thích

- **Tailwind v4** tách PostCSS plugin ra package riêng
- Cần cài `@tailwindcss/postcss` và dùng trong `postcss.config.js`
- `tailwind.config.js` vẫn giữ nguyên (không đổi)

## ✅ Sau Khi Fix

Kiểm tra:
- [ ] `npm install` chạy thành công
- [ ] `npm run dev` chạy được không còn lỗi
- [ ] Tailwind classes hoạt động (thử `bg-primary-500`, `text-white`)

---

**Lưu ý**: Nếu vẫn gặp lỗi, có thể downgrade về Tailwind v3:

```powershell
npm install -D tailwindcss@^3.4.0
```

Và đổi lại `postcss.config.js` về:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

