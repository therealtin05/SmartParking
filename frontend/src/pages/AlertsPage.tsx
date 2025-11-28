import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  fetchParkingAlerts,
  resolveParkingAlert,
  type ParkingAlert,
} from '../services/alertService';
import { useAuth } from '../context/AuthContext';

export function AlertsPage() {
  const { user } = useAuth();
  const ownerId = user?.uid ?? null;
  const [alerts, setAlerts] = useState<ParkingAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      if (!ownerId) {
        setAlerts([]);
        setError('Không tìm thấy thông tin người dùng.');
        setLoading(false);
        return;
      }
      const data = await fetchParkingAlerts({
        includeResolved: showResolved,
        limitCount: 100,
        ownerId,
      });
      setAlerts(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load alerts', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15_000);
    return () => clearInterval(interval);
  }, [showResolved, ownerId]);

  const handleResolve = async (alertId: string) => {
    if (!ownerId) return;
    await resolveParkingAlert(alertId);
    await loadAlerts();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">🚨 Parking Alerts</h1>
          <p className="text-gray-500 text-sm">
            Theo dõi xe đỗ sai vị trí theo thời gian thực (refresh 15s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show resolved
          </label>
          <button
            onClick={loadAlerts}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg shadow hover:bg-gray-700 transition"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500">Đang tải dữ liệu...</div>
      ) : alerts.length === 0 ? (
        <div className="p-10 bg-white border border-gray-200 rounded-xl text-center text-gray-500">
          <div className="text-6xl mb-3">🟢</div>
          Không có alert nào! Tất cả xe đều đỗ đúng chỗ.
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-5 rounded-xl border shadow-sm ${
                alert.resolved ? 'bg-gray-50 border-gray-200' : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm uppercase tracking-wide font-semibold">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        alert.violationType === 'RESTRICTED_ZONE'
                          ? 'bg-red-600 text-white'
                          : 'bg-yellow-500 text-white'
                      }`}
                    >
                      {alert.violationType === 'RESTRICTED_ZONE'
                        ? 'Restricted'
                        : 'Out of zone'}
                    </span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-600">{alert.cameraId}</span>
                    {alert.parking && (
                      <>
                        <span className="text-gray-500">•</span>
                        <span className="text-gray-600">{alert.parking}</span>
                      </>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-gray-900 mt-1">{alert.message}</p>
                  <p className="text-sm text-gray-500">
                    {formatDistanceToNow(alert.timestamp.toDate(), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!alert.resolved && (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      ✅ Resolve
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

