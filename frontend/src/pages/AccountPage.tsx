import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchDetections } from '../services/detectionService';

interface AdminStats {
  parkingCount: number;
  cameraCount: number;
  detectionCount: number;
  lastUpdated?: Date;
}

export function AccountPage() {
  const { user, role } = useAuth();
  const [adminStats, setAdminStats] = useState<AdminStats>({
    parkingCount: 0,
    cameraCount: 0,
    detectionCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      if (!user || role !== 'admin') {
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await fetchDetections({ ownerId: user.uid });
      if (result.success && result.data) {
        const parkingSet = new Set(result.data.map((record) => record.parkingId).filter(Boolean));
        setAdminStats({
          parkingCount: parkingSet.size,
          cameraCount: result.data.length,
          detectionCount: result.data.reduce((sum, record) => sum + (record.vehicleCount || 0), 0),
          lastUpdated: result.data[0]?.timestamp?.toDate?.() ?? undefined,
        });
      }
      setLoading(false);
    };
    loadStats();
  }, [user, role]);

  const cardClass =
    'p-4 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col gap-1';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">👤 Thông tin tài khoản</h1>
        <p className="text-gray-500 text-sm mt-1">
          Kiểm tra email, vai trò và các thống kê liên quan đến tài khoản của bạn.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <p className="text-sm text-gray-500">Email</p>
          <p className="text-lg font-semibold text-gray-900">{user?.email ?? '—'}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Vai trò</p>
            <p className="text-lg font-semibold capitalize text-gray-900">
              {role ?? 'Chưa xác định'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Trạng thái xác thực</p>
            <p className="text-lg font-semibold text-gray-900">
              {user?.emailVerified ? '✅ Đã xác thực email' : '⌛ Chưa xác thực email'}
            </p>
          </div>
        </div>
      </div>

      {role === 'admin' ? (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">📊 Thống kê quản trị</h2>
          {loading ? (
            <div className="p-6 text-center text-gray-500 bg-white border border-gray-200 rounded-2xl shadow-sm">
              Đang tải dữ liệu...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className={cardClass}>
                  <p className="text-sm text-gray-500">Số bãi đang quản lý</p>
                  <p className="text-3xl font-bold text-blue-600">{adminStats.parkingCount}</p>
                </div>
                <div className={cardClass}>
                  <p className="text-sm text-gray-500">Tổng số camera</p>
                  <p className="text-3xl font-bold text-purple-600">{adminStats.cameraCount}</p>
                </div>
                <div className={cardClass}>
                  <p className="text-sm text-gray-500">Tổng số lượt phát hiện</p>
                  <p className="text-3xl font-bold text-emerald-600">{adminStats.detectionCount}</p>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                Cập nhật lần cuối:{' '}
                {adminStats.lastUpdated
                  ? adminStats.lastUpdated.toLocaleString()
                  : 'Chưa lưu dữ liệu nào'}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">🚗 Thông tin dành cho Driver</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={cardClass}>
              <p className="text-sm text-gray-500">Số bãi đã xem</p>
              <p className="text-lg font-semibold text-gray-900">
                Đang thu thập — tính năng sẽ sớm có.
              </p>
            </div>
            <div className={cardClass}>
              <p className="text-sm text-gray-500">Thông tin xe của bạn</p>
              <p className="text-lg font-semibold text-gray-900">
                Đang phát triển. Bạn sẽ sớm thêm biển số và nhận thông báo cá nhân hóa.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

