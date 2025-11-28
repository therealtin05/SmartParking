import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchLatestDetections, type DetectionRecord } from '../services/detectionService';
import { createStreamSession, updateStreamSessionStatus } from '../services/streamService';
import {
  optimizeVideoQuality,
  optimizeVideoTrack,
  createHighQualityOffer,
} from '../utils/webrtcQuality';

const SIGNALING_URL = 'ws://localhost:3001';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const PARKING_ID_REGEX = /^[A-Za-z0-9]+$/;

type HostStatus = 'idle' | 'connecting' | 'streaming' | 'error';

interface HostTileConfig {
  id: string;
  parkingLotId: string;
  cameraId: string;
}

interface HostTileProps extends HostTileConfig {
  ownerId: string;
  onRemove: (id: string) => void;
}

function StreamHostTile({ id, parkingLotId, cameraId, ownerId, onRemove }: HostTileProps) {
  const [status, setStatus] = useState<HostStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoFileRef = useRef<File | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const hasViewerConnectedRef = useRef<boolean>(false); // Track if viewer ever connected

  const roomId = useMemo(() => {
    if (!parkingLotId.trim() || !cameraId.trim()) return null;
    return `${parkingLotId.trim()}__${cameraId.trim()}`;
  }, [parkingLotId, cameraId]);

  const handleSelectFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleVideoFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setHasFile(false);
      setFileName(null);
      return;
    }

    if (!file.type.startsWith('video/')) {
      setError('File phải là video');
      return;
    }

    videoFileRef.current = file;
    setFileName(file.name);
    setHasFile(true);
    const url = URL.createObjectURL(file);

    if (sourceVideoRef.current) {
      sourceVideoRef.current.src = url;
      sourceVideoRef.current.onloadedmetadata = () => {
        console.log(`[Host ${id}] Video loaded:`, file.name, sourceVideoRef.current?.duration);
      };
    }
  };

  // Tạo MediaStream từ video file (captureStream + fallback canvas)
  const createStreamFromVideo = (): Promise<MediaStream> => {
    return new Promise((resolve, reject) => {
      if (!sourceVideoRef.current) {
        reject(new Error('Video element not found'));
        return;
      }

      const video = sourceVideoRef.current;

      const createStream = () => {
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          video.onloadedmetadata = () => createStream();
          return;
        }

        const videoWithCapture = video as HTMLVideoElement & {
          captureStream?: (frameRate?: number) => MediaStream;
          mozCaptureStream?: (frameRate?: number) => MediaStream;
        };

        const captureFn =
          typeof videoWithCapture.captureStream === 'function'
            ? videoWithCapture.captureStream
            : typeof videoWithCapture.mozCaptureStream === 'function'
              ? videoWithCapture.mozCaptureStream
              : null;

        if (captureFn) {
          console.log(`[Host ${id}] Using captureStream`);
          // Gọi với ngữ cảnh là video element, tránh lỗi "Illegal invocation"
          const stream = captureFn.call(videoWithCapture, 30);

          video.onended = () => {
            console.log(`[Host ${id}] Video ended, looping`);
            video.currentTime = 0;
            video.play().catch((err) => console.error(`[Host ${id}] Replay error:`, err));
          };

          if (video.paused) {
            video
              .play()
              .catch((err) => console.error(`[Host ${id}] Error playing video:`, err));
          }

          resolve(stream);
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const stream = canvas.captureStream(30);
        let isDrawing = false;

        const draw = () => {
          if (!isDrawing) return;
          if (video.ended || video.paused) {
            video.currentTime = 0;
            video.play().catch((err) => console.error(`[Host ${id}] Loop play error:`, err));
          }
          if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          requestAnimationFrame(draw);
        };

        video.onended = () => {
          video.currentTime = 0;
          video.play().catch((err) => console.error(`[Host ${id}] Loop play error:`, err));
        };

        video
          .play()
          .then(() => {
            isDrawing = true;
            draw();
            resolve(stream);
          })
          .catch((err) => reject(new Error(`Failed to play video: ${err.message}`)));
      };

      if (video.readyState < 2) {
        video.onloadedmetadata = () => createStream();
        video.onerror = () => reject(new Error('Failed to load video'));
      } else {
        createStream();
      }
    });
  };

  const connect = async () => {
    try {
      if (!ownerId) {
        setError('Bạn cần đăng nhập để host stream.');
        return;
      }
      if (!roomId) {
        setError('Room ID không hợp lệ');
        return;
      }
      if (!videoFileRef.current) {
        setError('Vui lòng chọn video file');
        return;
      }

      setStatus('connecting');
      setError(null);

      // Chuẩn bị video element
      if (!sourceVideoRef.current) {
        setError('Không tìm thấy video element');
        setStatus('error');
        return;
      }
      sourceVideoRef.current.loop = true;
      sourceVideoRef.current.muted = true;

      const stream = await createStreamFromVideo();
      streamRef.current = stream;

      if (videoRef.current) {
        const preview = videoRef.current;
        // Reset trước khi gán stream mới
        preview.pause();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        preview.srcObject = null;
        // Gán stream và play
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        preview.srcObject = stream;
        preview.muted = true;
        preview.playsInline = true;
        const playPromise = preview.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            // AbortError thường vô hại (do browser tự pause khi đổi src)
            if (err?.name !== 'AbortError') {
              console.error(`[Host ${id}] Error playing preview:`, err);
            }
          });
        }
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      
      // Thêm tracks và tối ưu video quality
      stream.getTracks().forEach((track) => {
        optimizeVideoTrack(track);
        pc.addTrack(track, stream);
      });
      
      // Tối ưu video quality (bitrate, codec, resolution)
      await optimizeVideoQuality(pc);
      pcRef.current = pc;

      // Log session
      try {
        const result = await createStreamSession({
          ownerId,
          parkingId: parkingLotId.trim(),
          cameraId: cameraId.trim(),
          roomId,
          sourceType: 'video',
          videoFileName: videoFileRef.current?.name ?? null,
        });
        if (result.success && result.id) {
          streamSessionIdRef.current = result.id;
        }
      } catch (logErr) {
        console.warn(`[Host ${id}] Failed to create stream session:`, logErr);
      }

      const socket = new WebSocket(SIGNALING_URL);
      socketRef.current = socket;

      const connectionTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          console.error(`[Host ${id}] WebSocket connection timeout`);
          setError('Không thể kết nối đến signaling server');
          setStatus('error');
          socket.close();
        }
      }, 5000);

      socket.onopen = async () => {
        clearTimeout(connectionTimeout);
        console.log(`[Host ${id}] ✅ Connected to signaling server`);
        socket.send(JSON.stringify({ type: 'join', role: 'host', roomId }));

        // Tạo offer với codec preferences chất lượng cao
        const offer = await createHighQualityOffer(pc);
        await pc.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: 'offer', offer }));
        console.log(`[Host ${id}] ✅ High quality offer created and sent`);
        
        // Host đã sẵn sàng stream ngay cả khi chưa có viewer
        setStatus('streaming');
        setError(null); // Clear any previous errors
        if (streamSessionIdRef.current) {
          updateStreamSessionStatus(streamSessionIdRef.current, 'active');
        }
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            hasViewerConnectedRef.current = true; // Đánh dấu đã có viewer kết nối
            console.log(`[Host ${id}] ✅ Received answer from viewer`);
          } else if (data.type === 'ice') {
            await pc.addIceCandidate(data.candidate);
          }
        } catch (err) {
          console.error(`[Host ${id}] Error handling message:`, err);
        }
      };

      socket.onerror = (err) => {
        clearTimeout(connectionTimeout);
        console.error(`[Host ${id}] WebSocket error:`, err);
        setError('Lỗi kết nối signaling server');
        setStatus('error');
      };

      socket.onclose = () => {
        clearTimeout(connectionTimeout);
        console.log(`[Host ${id}] WebSocket closed`);
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
        console.log(`[Host ${id}] Connection state:`, pc.connectionState);
        
        // Nếu đã connected với viewer, giữ status streaming
        if (pc.connectionState === 'connected') {
          hasViewerConnectedRef.current = true;
          setStatus('streaming');
          setError(null); // Clear error nếu có
          if (streamSessionIdRef.current) {
            updateStreamSessionStatus(streamSessionIdRef.current, 'active');
          }
        } 
        // Chỉ coi là lỗi nếu đã từng có viewer và bị disconnect
        else if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && hasViewerConnectedRef.current) {
          // Đã từng có viewer nhưng bị mất kết nối - chỉ cảnh báo, không dừng stream
          console.warn(`[Host ${id}] ⚠️ Viewer disconnected, but host continues streaming`);
          setError(null); // Không hiển thị error, host vẫn tiếp tục stream
          // Giữ status = 'streaming' vì host vẫn đang stream, chỉ là không có viewer
        }
        // Nếu chưa có viewer, không làm gì - host vẫn stream bình thường
      };
    } catch (err: any) {
      console.error(`[Host ${id}] Error starting stream:`, err);
      setError(err.message || 'Không thể bắt đầu stream');
      setStatus('error');
    }
  };

  const disconnect = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (sourceVideoRef.current) {
      sourceVideoRef.current.pause();
      sourceVideoRef.current.src = '';
      videoFileRef.current = null;
    }
    setHasFile(false);
    setFileName(null);
    if (streamSessionIdRef.current) {
      updateStreamSessionStatus(streamSessionIdRef.current, 'ended');
      streamSessionIdRef.current = null;
    }
    hasViewerConnectedRef.current = false; // Reset viewer connection tracking
    setStatus('idle');
    setError(null);
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const canStart = hasFile && !!roomId && status === 'idle';

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
              status === 'streaming'
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
            {status === 'streaming' && 'Streaming'}
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
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSelectFileClick}
          className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
          disabled={status !== 'idle'}
        >
          📁 Chọn video
        </button>
        <input
          type="file"
          accept="video/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleVideoFileSelect}
        />
        <span className="text-xs text-gray-500 truncate">
          {fileName || 'Chưa chọn video'}
        </span>
        <button
          onClick={status === 'idle' ? connect : disconnect}
          disabled={!canStart && status === 'idle'}
          className={`ml-auto px-4 py-1.5 text-xs rounded-lg font-semibold transition ${
            status === 'idle'
              ? canStart
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
        >
          {status === 'idle' ? 'Bắt đầu phát' : 'Dừng phát'}
        </button>
      </div>
      <div className="bg-black relative aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
          controls
        />
        <video
          ref={sourceVideoRef}
          loop
          muted
          playsInline
          className="hidden"
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

export function MultiStreamHostPage() {
  const { user, role } = useAuth();
  const ownerId = user?.uid ?? '';

  const [availableParkings, setAvailableParkings] = useState<string[]>([]);
  const [availableCameras, setAvailableCameras] = useState<string[]>([]);
  const [parkingLotId, setParkingLotId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [parkingIdError, setParkingIdError] = useState<string | null>(null);
  const [cameraIdError, setCameraIdError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<HostTileConfig[]>([]);

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
        console.error('Failed to load cameras for multi-host:', err);
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
    const lot = parkingLotId.trim();
    const cam = cameraId.trim();
    const id = `${lot}__${cam}__${Date.now()}`;
    setTiles((prev) => {
      const exists = prev.some((t) => t.parkingLotId === lot && t.cameraId === cam);
      if (exists) return prev;
      return [...prev, { id, parkingLotId: lot, cameraId: cam }];
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
          <h1 className="text-3xl font-bold text-gray-900">📹 Multi Stream Host</h1>
          <p className="text-gray-500 text-sm">
            Host nhiều stream cùng lúc từ các video file khác nhau. Mỗi ô là một room riêng (Parking Lot ID + Camera ID).
          </p>
        </div>
        {role !== 'admin' && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            Chỉ Admin mới có quyền host stream.
          </div>
        )}
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={role !== 'admin'}
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={role !== 'admin'}
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={role !== 'admin'}
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={role !== 'admin'}
              />
            </div>
            {cameraIdError && (
              <p className="mt-1 text-xs text-red-600">{cameraIdError}</p>
            )}
          </div>
          <div className="flex items-center md:justify-end">
            <button
              onClick={handleAddTile}
              disabled={!canAdd || role !== 'admin'}
              className={`w-full md:w-auto px-6 py-2 rounded-lg font-semibold transition ${
                canAdd && role === 'admin'
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              ➕ Thêm host
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ID chỉ gồm chữ cái tiếng Anh và số, không dấu và không khoảng trắng. Một combo Parking Lot
          + Camera chỉ được thêm một lần.
        </p>
      </div>

      {/* Grid hosts */}
      {tiles.length === 0 ? (
        <div className="p-10 bg-white border border-dashed border-gray-300 rounded-2xl text-center text-gray-500">
          Chưa có host nào. Hãy chọn Parking Lot ID + Camera ID rồi bấm{' '}
          <span className="font-semibold">“Thêm host”</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tiles.map((tile) => (
            <StreamHostTile
              key={tile.id}
              id={tile.id}
              parkingLotId={tile.parkingLotId}
              cameraId={tile.cameraId}
              ownerId={ownerId}
              onRemove={(removeId) =>
                setTiles((prev) => prev.filter((t) => t.id !== removeId))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}


