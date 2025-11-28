import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fetchLatestDetections, type DetectionRecord } from '../services/detectionService';
import { ParkingMap2D } from '../components/ParkingMap2D';
import { useAuth } from '../context/AuthContext';

interface CameraCardProps {
  record: DetectionRecord;
}

function CameraCard({ record }: CameraCardProps) {
  const spaces = record.spaces || [];
  const safeInputUrl =
    record.inputImageUrl && record.inputImageUrl.startsWith('blob:')
      ? undefined
      : record.inputImageUrl;
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!safeInputUrl) {
      setImageSize(null);
      return;
    }
    let isMounted = true;
    const img = new Image();
    img.onload = () => {
      if (!isMounted) return;
      setImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.onerror = () => {
      if (!isMounted) return;
      setImageSize(null);
    };
    img.src = safeInputUrl;
    return () => {
      isMounted = false;
    };
  }, [safeInputUrl]);

  const aspectRatio = imageSize
    ? Math.max(imageSize.height / imageSize.width, 0.3)
    : 9 / 16;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-sm uppercase text-gray-500 tracking-wide">
            {record.parkingId || 'Unknown Lot'}
          </div>
          <h2 className="text-xl font-semibold text-gray-900">{record.cameraId}</h2>
          <p className="text-xs text-gray-400">
            {record.timestamp.toDate().toLocaleString()} •{' '}
            {formatDistanceToNow(record.timestamp.toDate(), { addSuffix: true })}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold ${
            spaces.length > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {spaces.length} spaces
        </span>
      </div>
      <div className="flex-1 p-4 bg-gray-50">
        {safeInputUrl && spaces.length > 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden relative w-full">
            <div
              className="w-full"
              style={{ paddingTop: `${aspectRatio * 100}%`, minHeight: '220px' }}
            />
            <div className="absolute inset-0">
              <ParkingMap2D
                spaces={spaces}
                selectedSpaceId={null}
                imageWidth={imageSize?.width}
                imageHeight={imageSize?.height}
                sourceImageUrl={safeInputUrl}
                previewMode
              />
            </div>
          </div>
        ) : (
          <div className="relative text-gray-400 rounded-xl border border-gray-200 bg-white">
            <div className="w-full" style={{ paddingTop: '56.25%', minHeight: '220px' }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-4xl mb-2">🛰️</div>
              <p>No preview available</p>
            </div>
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 text-sm text-gray-600">
        Update #{record.updateCount || 1} • Camera ID: {record.cameraId}
      </div>
    </div>
  );
}

export function MultiCameraPage() {
  const { user } = useAuth();
  const ownerId = user?.uid ?? null;
  const [records, setRecords] = useState<DetectionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCameras = async () => {
    if (!ownerId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await fetchLatestDetections({ ownerId });
    if (result.success && result.data) {
      setRecords(result.data);
    } else {
      setRecords([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCameras();
    const interval = setInterval(fetchCameras, 15_000);
    return () => clearInterval(interval);
  }, [ownerId]);

  const parkingOptions = useMemo(() => {
    const lots = new Set<string>();
    records.forEach((record) => {
      if (record.parkingId) {
        lots.add(record.parkingId);
      }
    });
    return Array.from(lots);
  }, [records]);

  const [selectedParking, setSelectedParking] = useState<string>('all');

  useEffect(() => {
    if (parkingOptions.length === 0) {
      setSelectedParking('all');
      return;
    }
    if (selectedParking !== 'all' && !parkingOptions.includes(selectedParking)) {
      setSelectedParking(parkingOptions[0]);
    }
  }, [parkingOptions, selectedParking]);

  const filteredRecords = useMemo(() => {
    if (selectedParking === 'all') {
      return records;
    }
    return records.filter((record) => record.parkingId === selectedParking);
  }, [records, selectedParking]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">🎥 Multi-Camera Monitor</h1>
          <p className="text-gray-500 text-sm">
            Chọn một bãi xe để xem tất cả camera thuộc cùng khu vực.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={selectedParking}
            onChange={(event) => setSelectedParking(event.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Tất cả bãi xe</option>
            {parkingOptions.map((parking) => {
              const label = parking;
              return (
                <option key={parking} value={parking}>
                  {label}
                </option>
              );
            })}
          </select>
          <button
            onClick={fetchCameras}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg shadow hover:bg-gray-700 transition"
          >
            🔄 Refresh now
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-500">Đang tải camera...</div>
      ) : filteredRecords.length === 0 ? (
        <div className="p-10 bg-white border border-gray-200 rounded-2xl text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="text-gray-600">
            {selectedParking === 'all'
              ? 'Chưa có dữ liệu. Vào Live View và lưu detection cho từng camera.'
              : 'Chưa có camera nào thuộc bãi xe này. Hãy lưu detection với đúng Parking Lot trong Live View.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredRecords.map((record) => (
            <CameraCard key={record.cameraId} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}

