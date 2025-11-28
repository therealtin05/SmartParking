import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const API_URL = 'http://localhost:3001/api/object-tracking';

interface TrackingResult {
  success: boolean;
  total_frames?: number;
  processed_frames?: number;
  unique_tracks?: number;
  video_width?: number;
  video_height?: number;
  fps?: number;
  annotatedVideo?: string;
  tracks?: any[];
  track_history?: any;
  summary?: {
    total_objects_detected: number;
    total_detections: number;
    avg_detections_per_frame: number;
  };
  error?: string;
}

export function ObjectTrackingPage() {
  const { user } = useAuth();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Settings
  const [frameSkip, setFrameSkip] = useState(1);
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [useSAM3, setUseSAM3] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setError('File phải là video (mp4, webm, etc.)');
      return;
    }

    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const handleSelectFileClick = () => {
    fileInputRef.current?.click();
  };

  const convertVideoToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleProcess = async () => {
    if (!videoFile) {
      setError('Vui lòng chọn video trước');
      return;
    }

    setProcessing(true);
    setError(null);
    setProgress('Đang chuyển đổi video sang base64...');
    setResult(null);

    try {
      // Convert video to base64
      const videoData = await convertVideoToBase64(videoFile);
      
      setProgress('Đang gửi video lên server...');
      
      // Send to backend
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoData,
          frameSkip,
          confThreshold,
          iouThreshold,
          useSAM3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      setProgress('Đang xử lý video...');
      const data: TrackingResult = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Processing failed');
      }

      setResult(data);
      setProgress('Hoàn tất!');
      
      // Auto-play result video
      setTimeout(() => {
        if (resultVideoRef.current) {
          resultVideoRef.current.play().catch(console.error);
        }
      }, 500);
    } catch (err) {
      console.error('Tracking error:', err);
      setError(err instanceof Error ? err.message : 'Lỗi không xác định');
      setProgress('');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-strawberry-900 mb-2">
          🎯 Object Tracking
        </h1>
        <p className="text-strawberry-700">
          Tracking đối tượng trong video với ByteTrack và SAM3. Upload video để bắt đầu.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input Section */}
        <div className="space-y-6">
          {/* File Upload */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-strawberry-100">
            <h2 className="text-xl font-semibold text-strawberry-900 mb-4">
              📁 Chọn Video
            </h2>
            
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <button
                onClick={handleSelectFileClick}
                disabled={processing}
                className="w-full px-4 py-3 bg-matcha-600 text-white rounded-lg font-medium hover:bg-matcha-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-md"
              >
                {videoFile ? `📹 ${videoFile.name}` : '📁 Chọn Video'}
              </button>

              {videoPreview && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600 mb-2">Video gốc:</p>
                  <video
                    src={videoPreview}
                    controls
                    className="w-full rounded-lg border border-strawberry-200"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Settings */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-strawberry-100">
            <h2 className="text-xl font-semibold text-strawberry-900 mb-4">
              ⚙️ Cài Đặt
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Frame Skip (xử lý mỗi N frame)
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={frameSkip}
                  onChange={(e) => setFrameSkip(parseInt(e.target.value) || 1)}
                  disabled={processing}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-matcha-500 focus:border-matcha-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  1 = tất cả frames, 2 = mỗi 2 frames, ...
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confidence Threshold: {confThreshold}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                  disabled={processing}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Ngưỡng tin cậy cho detection (cao hơn = chính xác hơn nhưng ít detection hơn)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IOU Threshold: {iouThreshold}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={iouThreshold}
                  onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
                  disabled={processing}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Ngưỡng IOU cho NMS (Non-Maximum Suppression)
                </p>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="useSAM3"
                  checked={useSAM3}
                  onChange={(e) => setUseSAM3(e.target.checked)}
                  disabled={processing}
                  className="w-4 h-4 text-matcha-600 border-gray-300 rounded focus:ring-matcha-500"
                />
                <label htmlFor="useSAM3" className="ml-2 text-sm text-gray-700">
                  Sử dụng SAM3 cho segmentation (nếu có)
                </label>
              </div>
            </div>
          </div>

          {/* Process Button */}
          <button
            onClick={handleProcess}
            disabled={!videoFile || processing}
            className="w-full px-6 py-4 bg-matcha-600 text-white rounded-lg font-semibold text-lg hover:bg-matcha-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            {processing ? '⏳ Đang xử lý...' : '🚀 Bắt Đầu Tracking'}
          </button>

          {/* Progress */}
          {progress && (
            <div className="bg-matcha-50 border border-matcha-200 rounded-lg p-4">
              <p className="text-matcha-800 font-medium">{progress}</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">❌ {error}</p>
            </div>
          )}
        </div>

        {/* Right: Results Section */}
        <div className="space-y-6">
          {/* Annotated Video */}
          {result?.annotatedVideo && (
            <div className="bg-white rounded-xl shadow-lg p-6 border border-strawberry-100">
              <h2 className="text-xl font-semibold text-strawberry-900 mb-4">
                🎬 Video Đã Tracking
              </h2>
              <video
                ref={resultVideoRef}
                src={result.annotatedVideo}
                controls
                className="w-full rounded-lg border border-strawberry-200"
                autoPlay
              />
            </div>
          )}

          {/* Statistics */}
          {result?.summary && (
            <div className="bg-white rounded-xl shadow-lg p-6 border border-strawberry-100">
              <h2 className="text-xl font-semibold text-strawberry-900 mb-4">
                📊 Thống Kê
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-strawberry-50 rounded-lg p-4 border border-strawberry-200">
                  <p className="text-sm text-strawberry-700 font-medium">Tổng Frames</p>
                  <p className="text-2xl font-bold text-strawberry-900">
                    {result.total_frames || 0}
                  </p>
                </div>
                <div className="bg-strawberry-50 rounded-lg p-4 border border-strawberry-200">
                  <p className="text-sm text-strawberry-700 font-medium">Frames Đã Xử Lý</p>
                  <p className="text-2xl font-bold text-strawberry-900">
                    {result.processed_frames || 0}
                  </p>
                </div>
                <div className="bg-matcha-50 rounded-lg p-4 border border-matcha-200">
                  <p className="text-sm text-matcha-700 font-medium">Số Object Được Track</p>
                  <p className="text-2xl font-bold text-matcha-900">
                    {result.unique_tracks || 0}
                  </p>
                </div>
                <div className="bg-matcha-50 rounded-lg p-4 border border-matcha-200">
                  <p className="text-sm text-matcha-700 font-medium">Tổng Detections</p>
                  <p className="text-2xl font-bold text-matcha-900">
                    {result.summary.total_detections || 0}
                  </p>
                </div>
                {result.video_width && result.video_height && (
                  <div className="bg-strawberry-50 rounded-lg p-4 border border-strawberry-200 col-span-2">
                    <p className="text-sm text-strawberry-700 font-medium">Kích Thước Video</p>
                    <p className="text-lg font-semibold text-strawberry-900">
                      {result.video_width} × {result.video_height} @ {result.fps || 30} FPS
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Track History (if available) */}
          {result?.track_history && Object.keys(result.track_history).length > 0 && (
            <div className="bg-white rounded-xl shadow-lg p-6 border border-strawberry-100">
              <h2 className="text-xl font-semibold text-strawberry-900 mb-4">
                🗺️ Track History
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {Object.entries(result.track_history).map(([trackId, positions]: [string, any]) => (
                  <div key={trackId} className="bg-gray-50 rounded p-3 border border-gray-200">
                    <p className="font-medium text-gray-800">
                      Track ID: {trackId} ({Array.isArray(positions) ? positions.length : 0} positions)
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Placeholder when no result */}
          {!result && !processing && (
            <div className="bg-gray-50 rounded-xl shadow-lg p-12 border border-gray-200 text-center">
              <p className="text-gray-500 text-lg">
                Kết quả tracking sẽ hiển thị ở đây
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

