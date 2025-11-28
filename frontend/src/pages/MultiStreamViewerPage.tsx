import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchLatestDetections, type DetectionRecord } from '../services/detectionService';
import {
  optimizeVideoElement,
  createHighQualityAnswer,
} from '../utils/webrtcQuality';

const SIGNALING_URL = 'ws://localhost:3001';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const PARKING_ID_REGEX = /^[A-Za-z0-9]+$/;

type TileStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface StreamTileConfig {
  id: string;
  parkingLotId: string;
  cameraId: string;
}

interface StreamTileProps extends StreamTileConfig {
  onRemove: (id: string) => void;
}

// Một tile viewer độc lập (mỗi tile có 1 PeerConnection + WebSocket riêng)
function StreamViewerTile({ id, parkingLotId, cameraId, onRemove }: StreamTileProps) {
  const [status, setStatus] = useState<TileStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const roomId = useMemo(() => {
    if (!parkingLotId.trim() || !cameraId.trim()) return null;
    return `${parkingLotId.trim()}__${cameraId.trim()}`;
  }, [parkingLotId, cameraId]);

  const videoId = `stream-video-${id}`;

  // Lưu connection objects trong ref cục bộ (không cần re-render)
  const connectionRef = useMemo(
    () => ({
      pc: null as RTCPeerConnection | null,
      socket: null as WebSocket | null,
    }),
    [],
  );

  const disconnect = useCallback(() => {
    if (connectionRef.pc) {
      connectionRef.pc.close();
      connectionRef.pc = null;
    }
    if (connectionRef.socket) {
      connectionRef.socket.close();
      connectionRef.socket = null;
    }

    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    if (video) {
      video.srcObject = null;
    }

    setStatus('idle');
    setError(null);
  }, [connectionRef, videoId]);

  const startViewing = useCallback(async () => {
    try {
      if (!roomId) {
        setError('Room ID không hợp lệ');
        return;
      }

      setStatus('connecting');
      setError(null);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      connectionRef.pc = pc;

      pc.ontrack = async (event) => {
        console.log(`[Tile ${id}] ✅ Received track:`, event.track.kind, event.track.id);
        if (event.streams && event.streams.length > 0) {
          const video = document.getElementById(videoId) as HTMLVideoElement | null;
          if (video) {
            const stream = event.streams[0];
            
            // Tối ưu video element cho chất lượng cao
            optimizeVideoElement(video);
            
            video.srcObject = stream;
            try {
              await video.play();
              console.log(`[Tile ${id}] ✅ Video playing with optimized quality`);
            } catch (err) {
              console.error(`[Tile ${id}] Error playing video:`, err);
            }
          }
        }
      };

      const socket = new WebSocket(SIGNALING_URL);
      connectionRef.socket = socket;

      const connectionTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          console.error(`[Tile ${id}] WebSocket connection timeout`);
          setError('Không thể kết nối đến signaling server.');
          setStatus('error');
          socket.close();
        }
      }, 5000);

      socket.onopen = async () => {
        clearTimeout(connectionTimeout);
        console.log(`[Tile ${id}] ✅ Connected to signaling server`);
        socket.send(JSON.stringify({ type: 'join', role: 'viewer', roomId }));
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'offer') {
            // Tạo answer với codec preferences chất lượng cao
            const answer = await createHighQualityAnswer(pc, data.offer);
            await pc.setLocalDescription(answer);
            socket.send(JSON.stringify({ type: 'answer', answer }));
            console.log(`[Tile ${id}] ✅ Sent high quality answer to host`);
          } else if (data.type === 'ice') {
            await pc.addIceCandidate(data.candidate);
          }
        } catch (err) {
          console.error(`[Tile ${id}] Error handling message:`, err);
          setError('Lỗi xử lý tín hiệu từ host');
          setStatus('error');
        }
      };

      socket.onerror = (err) => {
        clearTimeout(connectionTimeout);
        console.error(`[Tile ${id}] WebSocket error:`, err);
        setError('Lỗi kết nối signaling server');
        setStatus('error');
      };

      socket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log(`[Tile ${id}] WebSocket closed`, event.code, event.reason);
        if (status !== 'idle' && status !== 'error') {
          setStatus('idle');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ice', candidate: event.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[Tile ${id}] Connection state:`, pc.connectionState);
        if (pc.connectionState === 'connected') {
          setStatus('connected');
          setError(null);
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus('error');
          setError('Mất kết nối với host');
        }
      };
    } catch (err: any) {
      console.error(`[Tile ${id}] Error connecting to stream:`, err);
      setError(err.message || 'Không thể kết nối');
      setStatus('error');
    }
  }, [connectionRef, id, roomId, videoId, status]);

  useEffect(() => {
    // Tự động kết nối khi tile được tạo
    startViewing();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-white rounded-xl shadow border border-gray-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            {parkingLotId} • {cameraId}
          </div>
          <div className="text-xs text-gray-400 truncate max-w-xs">
            Room: {roomId || '—'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${
              status === 'connected'
                ? 'bg-green-100 text-green-700'
                : status === 'connecting'
                  ? 'bg-yellow-100 text-yellow-700'
                  : status === 'error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600'
            }`}
          >
            {status === 'idle' && 'Idle'}
            {status === 'connecting' && 'Connecting'}
            {status === 'connected' && 'Connected'}
            {status === 'error' && 'Error'}
          </span>
          <button
            onClick={() => {
              disconnect();
              onRemove(id);
            }}
            className="text-xs text-gray-500 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="bg-black relative aspect-video">
        <video
          id={videoId}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
          controls
        />
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">
          {error}
        </div>
      )}
    </div>
  );
}

export function MultiStreamViewerPage() {
  const { user } = useAuth();
  const ownerId = user?.uid ?? null;

  const [availableParkings, setAvailableParkings] = useState<string[]>([]);
  const [availableCameras, setAvailableCameras] = useState<string[]>([]);
  const [parkingLotId, setParkingLotId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [parkingIdError, setParkingIdError] = useState<string | null>(null);
  const [cameraIdError, setCameraIdError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<StreamTileConfig[]>([]);

  // Load list camera từ detections
  useEffect(() => {
    const load = async () => {
      if (!ownerId) {
        setAvailableParkings([]);
        setAvailableCameras([]);
        return;
      }
      try {
        const result = await fetchLatestDetections({ ownerId });
        if (result.success && result.data) {
          const parkings = new Set<string>();
          const cameras = new Set<string>();
          result.data.forEach((r: DetectionRecord) => {
            if (r.parkingId) parkings.add(r.parkingId);
            if (r.cameraId) cameras.add(r.cameraId);
          });
          setAvailableParkings(Array.from(parkings).sort());
          setAvailableCameras(Array.from(cameras).sort());
        }
      } catch (err) {
        console.error('Failed to load cameras for multi-stream:', err);
      }
    };
    load();
  }, [ownerId]);

  const validateParkingId = (value: string) => {
    if (!value.trim()) {
      setParkingIdError('Parking Lot ID không được để trống');
      return false;
    }
    if (!PARKING_ID_REGEX.test(value.trim())) {
      setParkingIdError('Parking Lot ID chỉ được chứa chữ cái tiếng Anh và số, không dấu, không khoảng trắng');
      return false;
    }
    setParkingIdError(null);
    return true;
  };

  const validateCameraId = (value: string) => {
    if (!value.trim()) {
      setCameraIdError('Camera ID không được để trống');
      return false;
    }
    if (!PARKING_ID_REGEX.test(value.trim())) {
      setCameraIdError('Camera ID chỉ được chứa chữ cái tiếng Anh và số, không dấu, không khoảng trắng');
      return false;
    }
    setCameraIdError(null);
    return true;
  };

  const handleAddTile = () => {
    if (!validateParkingId(parkingLotId) || !validateCameraId(cameraId)) {
      return;
    }
    const id = `${parkingLotId.trim()}__${cameraId.trim()}__${Date.now()}`;
    setTiles((prev) => {
      // tránh thêm trùng (cùng lot + cam)
      const exists = prev.some(
        (t) => t.parkingLotId === parkingLotId.trim() && t.cameraId === cameraId.trim(),
      );
      if (exists) return prev;
      return [
        ...prev,
        {
          id,
          parkingLotId: parkingLotId.trim(),
          cameraId: cameraId.trim(),
        },
      ];
    });
  };

  const canAdd =
    parkingLotId.trim().length > 0 &&
    cameraId.trim().length > 0 &&
    !parkingIdError &&
    !cameraIdError;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">🧩 Multi Stream Viewer</h1>
          <p className="text-gray-500 text-sm">
            Thêm nhiều stream (Parking Lot ID + Camera ID) để xem đồng thời trên một màn hình.
          </p>
        </div>
      </div>

      {/* Config add tile */}
      <div className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Parking Lot ID
            </label>
            <div className="flex gap-2">
              <select
                value={parkingLotId}
                onChange={(e) => {
                  setParkingLotId(e.target.value);
                  validateParkingId(e.target.value);
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">-- Chọn hoặc nhập mới --</option>
                {availableParkings.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={parkingLotId}
                onChange={(e) => {
                  setParkingLotId(e.target.value);
                  validateParkingId(e.target.value);
                }}
                placeholder="Nhập Parking Lot ID"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            {parkingIdError && (
              <p className="mt-1 text-xs text-red-600">{parkingIdError}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Camera ID
            </label>
            <div className="flex gap-2">
              <select
                value={cameraId}
                onChange={(e) => {
                  setCameraId(e.target.value);
                  validateCameraId(e.target.value);
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">-- Chọn hoặc nhập mới --</option>
                {availableCameras.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={cameraId}
                onChange={(e) => {
                  setCameraId(e.target.value);
                  validateCameraId(e.target.value);
                }}
                placeholder="Nhập Camera ID"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            {cameraIdError && (
              <p className="mt-1 text-xs text-red-600">{cameraIdError}</p>
            )}
          </div>
          <div className="flex items-center md:justify-end">
            <button
              onClick={handleAddTile}
              disabled={!canAdd}
              className={`w-full md:w-auto px-6 py-2 rounded-lg font-semibold transition ${
                canAdd
                  ? 'bg-teal-600 text-white hover:bg-teal-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              ➕ Thêm stream
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ID chỉ gồm chữ cái tiếng Anh và số, không dấu và không khoảng trắng. Một combo Parking
          Lot + Camera chỉ được thêm một lần.
        </p>
      </div>

      {/* Grid streams */}
      {tiles.length === 0 ? (
        <div className="p-10 bg-white border border-dashed border-gray-300 rounded-2xl text-center text-gray-500">
          Chưa có stream nào. Hãy chọn Parking Lot ID + Camera ID rồi bấm{' '}
          <span className="font-semibold">“Thêm stream”</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tiles.map((tile) => (
            <StreamViewerTile
              key={tile.id}
              id={tile.id}
              parkingLotId={tile.parkingLotId}
              cameraId={tile.cameraId}
              onRemove={(idToRemove) =>
                setTiles((prev) => prev.filter((t) => t.id !== idToRemove))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}


