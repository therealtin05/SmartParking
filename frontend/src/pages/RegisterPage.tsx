import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../context/AuthContext';

const ROLES: { label: string; value: UserRole; description: string }[] = [
  { label: 'Admin', value: 'admin', description: 'Toàn quyền quản trị dashboard' },
  { label: 'Driver', value: 'driver', description: 'Chỉ xem dữ liệu được phép' },
];

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('driver');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email, password, role);
      
      if (role === 'admin') {
        setSuccess(true);
        alert(
          '✅ Tài khoản đã được tạo!\n\n' +
          '📧 Email xác nhận đã được gửi đến ' + email + '\n\n' +
          '⚠️ Vui lòng kiểm tra email và click vào link xác nhận để kích hoạt quyền Admin.\n' +
          'Hiện tại bạn chỉ có quyền Driver. Sau khi xác nhận email, đăng nhập lại để có quyền Admin.'
        );
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      console.error('Register failed', err);
      setError(err instanceof Error ? err.message : 'Không thể tạo tài khoản. Kiểm tra lại thông tin hoặc thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="max-w-lg w-full bg-white shadow-lg rounded-2xl p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Tạo tài khoản Smart Parking</h1>
          <p className="text-gray-500 text-sm">
            Chọn vai trò phù hợp (Admin hoặc Driver) để truy cập hệ thống.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">Chọn vai trò</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ROLES.map((roleOption) => (
                <label
                  key={roleOption.value}
                  tabIndex={0}
                  className={`border rounded-xl p-3 cursor-pointer transition shadow-sm ${
                    role === roleOption.value
                      ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={roleOption.value}
                    checked={role === roleOption.value}
                    onChange={() => setRole(roleOption.value)}
                    className="hidden"
                  />
                  <div className="font-semibold text-gray-800">{roleOption.label}</div>
                  <div className="text-xs text-gray-500 mt-1">{roleOption.description}</div>
                </label>
              ))}
            </div>
          </div>

          {role === 'admin' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>⚠️ Lưu ý:</strong> Khi đăng ký tài khoản Admin, hệ thống sẽ gửi email xác nhận đến địa chỉ email của bạn. 
                Bạn cần click vào link trong email để xác nhận và kích hoạt quyền Admin. 
                Nếu chưa xác nhận email, bạn sẽ chỉ có quyền Driver.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {success && role === 'admin' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-semibold mb-2">
                ✅ Tài khoản đã được tạo thành công!
              </p>
              <p className="text-sm text-green-700">
                Email xác nhận đã được gửi đến <strong>{email}</strong>. 
                Vui lòng kiểm tra hộp thư (kể cả spam) và click vào link xác nhận.
              </p>
              <p className="text-xs text-green-600 mt-2">
                Sau khi xác nhận email, đăng nhập lại để có quyền Admin.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2 rounded-lg text-white font-semibold transition ${
              loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>
        </form>

        <div className="text-sm text-center text-gray-500">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-blue-600 font-semibold hover:underline">
            Đăng nhập ngay
          </Link>
        </div>
      </div>
    </div>
  );
}

