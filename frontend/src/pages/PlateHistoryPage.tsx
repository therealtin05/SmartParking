import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import {
  fetchPlateDetections,
  deletePlateDetection,
  type PlateDetectionRecord,
} from '../services/plateDetectionService';

export function PlateHistoryPage() {
  const { user, role } = useAuth();
  const ownerId = user?.uid ?? null;
  const isAdmin = role === 'admin';

  const [records, setRecords] = useState<PlateDetectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedParking, setSelectedParking] = useState('all');
  const [error, setError] = useState<string | null>(null);
  
  // Sort state
  const [sortBy, setSortBy] = useState<'time' | 'plate' | 'confidence' | 'parkingId' | 'cameraId'>('time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const loadRecords = async () => {
      if (!ownerId) {
        setRecords([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const result = await fetchPlateDetections({ ownerId });
      if (result.success && result.data) {
        setRecords(result.data);
        setError(null);
      } else {
        setRecords([]);
        setError(result.error || 'Không thể tải dữ liệu');
      }
      setLoading(false);
    };
    loadRecords();
  }, [ownerId]);

  const parkingOptions = useMemo(() => {
    const lots = new Set<string>();
    records.forEach((record) => {
      if (record.parkingId) lots.add(record.parkingId);
    });
    return Array.from(lots);
  }, [records]);

  const filteredRecords = useMemo(() => {
    let filtered = records;
    if (selectedParking !== 'all') {
      filtered = records.filter((record) => record.parkingId === selectedParking);
    }
    
    // Apply sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'time':
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case 'plate':
          comparison = a.plateText.localeCompare(b.plateText);
          break;
        case 'parkingId':
          comparison = (a.parkingId || '').localeCompare(b.parkingId || '');
          break;
        case 'cameraId':
          comparison = (a.cameraId || '').localeCompare(b.cameraId || '');
          break;
        case 'confidence':
          comparison = a.confidence - b.confidence;
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [records, selectedParking, sortBy, sortOrder]);

  const handleDelete = async (recordId: string) => {
    if (!isAdmin) return;
    const confirmDelete = window.confirm('Xóa bản ghi nhận diện biển số này?');
    if (!confirmDelete) return;
    const result = await deletePlateDetection(recordId);
    if (result.success) {
      setRecords((prev) => prev.filter((record) => record.id !== recordId));
    } else {
      alert(result.error || 'Không thể xóa bản ghi');
    }
  };

  if (!ownerId) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Vui lòng đăng nhập để xem lịch sử nhận diện biển số.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-500">
        <div className="text-4xl mb-2">⏳</div>
        Đang tải dữ liệu...
      </div>
    );
  }

  if (filteredRecords.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <h1 className="text-3xl font-semibold text-gray-900">📘 Plate History</h1>
          <select
            value={selectedParking}
            onChange={(e) => setSelectedParking(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">Tất cả bãi xe</option>
            {parkingOptions.map((parking) => (
              <option key={parking} value={parking}>
                {parking}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-500">
          <div className="text-5xl mb-2">🗂️</div>
          {error ? error : 'Chưa có dữ liệu nhận diện biển số'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">📘 Plate History</h1>
          <p className="text-sm text-gray-500">
            Danh sách các lần nhận diện biển số đã lưu vào hệ thống.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <select
            value={selectedParking}
            onChange={(e) => setSelectedParking(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">Tất cả bãi xe</option>
            {parkingOptions.map((parking) => (
              <option key={parking} value={parking}>
                {parking}
              </option>
            ))}
          </select>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-600">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => {
                const newSortBy = e.target.value as typeof sortBy;
                setSortBy(newSortBy);
                // Set default sort order based on field
                if (newSortBy === 'time' || newSortBy === 'confidence') {
                  setSortOrder('desc');
                } else {
                  setSortOrder('asc');
                }
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="time">Thời gian</option>
              <option value="plate">Biển số</option>
              <option value="parkingId">ID Bãi</option>
              <option value="cameraId">ID Cam</option>
              <option value="confidence">Độ tin cậy</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              title={`Sort ${sortOrder === 'asc' ? 'Tăng dần' : 'Giảm dần'}`}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {filteredRecords.map((record) => (
          <div key={record.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-start">
              <div>
                <div className="text-xs uppercase text-gray-500">{record.parkingId}</div>
                <div className="text-xl font-semibold text-gray-900 tracking-wide">
                  {record.plateText}
                </div>
                <div className="text-sm text-gray-500">
                  Camera: {record.cameraId} •{' '}
                  {format(record.createdAt, 'dd/MM/yyyy HH:mm:ss')}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">Confidence</div>
                <div className="text-lg font-bold text-matcha-600">
                  {(record.confidence * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50">
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
                <img
                  src={record.annotatedImageUrl || record.inputImageUrl}
                  alt={record.plateText}
                  className="w-full object-contain"
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-between items-center">
              <div className="text-xs text-gray-500 break-all">
                ID: {record.id}
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleDelete(record.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  🗑️ Xóa
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

