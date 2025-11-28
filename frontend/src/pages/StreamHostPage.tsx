import { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchLatestDetections, type DetectionRecord } from '../services/detectionService';
import { createStreamSession, updateStreamSessionStatus } from '../services/streamService';
import { savePlateDetection } from '../services/plateDetectionService';
import {
  optimizeVideoQuality,
  optimizeVideoTrack,
  createHighQualityOffer,
  HIGH_QUALITY_VIDEO_CONSTRAINTS,
} from '../utils/webrtcQuality';

const SIGNALING_URL = 'ws://localhost:3001';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const PARKING_ID_REGEX = /^[A-Za-z0-9]+$/;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// Firebase Firestore field limit: 1,048,487 bytes (1MB)
const FIRESTORE_FIELD_LIMIT = 1_048_487;
const DATA_URL_MARGIN = 25_000; // Buffer để đảm bảo không vượt quá limit

type StreamSource = 'camera' | 'video';

// Helper function để estimate kích thước data URL (bytes)
function estimateDataUrlBytes(dataUrl?: string | null): number {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(',')[1];
  if (!base64) return 0;
  return Math.ceil((base64.length * 3) / 4);
}

// Helper function để compress image data URL để fit trong Firestore limit
async function compressImageForFirestore(
  dataUrl: string, 
  maxSizeBytes: number = FIRESTORE_FIELD_LIMIT - DATA_URL_MARGIN,
  targetMaxWidth: number = 1280,
  targetMaxHeight: number = 720
): Promise<string> {
  const currentSize = estimateDataUrlBytes(dataUrl);
  
  // Nếu đã nhỏ hơn limit thì không cần compress
  if (currentSize <= maxSizeBytes) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl); // Fallback to original
        return;
      }
      
      // Tính toán kích thước mới để đảm bảo fit trong limit
      let width = img.width;
      let height = img.height;
      
      // Bước 1: Giảm resolution nếu cần
      if (width > targetMaxWidth || height > targetMaxHeight) {
        const ratio = Math.min(targetMaxWidth / width, targetMaxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }
      
      // Bước 2: Nếu vẫn quá lớn, giảm tiếp resolution
      // Thử giảm từng bước cho đến khi fit
      const resolutionSteps = [
        { w: width, h: height },
        { w: Math.floor(width * 0.8), h: Math.floor(height * 0.8) },
        { w: Math.floor(width * 0.6), h: Math.floor(height * 0.6) },
        { w: Math.floor(width * 0.5), h: Math.floor(height * 0.5) },
        { w: 800, h: 600 },
        { w: 640, h: 480 },
      ];
      
      const qualities = [0.7, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];
      
      let bestResult = dataUrl;
      let bestSize = currentSize;
      
      // Thử từng resolution và quality
      for (const step of resolutionSteps) {
        canvas.width = step.w;
        canvas.height = step.h;
        ctx.drawImage(img, 0, 0, step.w, step.h);
        
        for (const quality of qualities) {
          const compressed = canvas.toDataURL('image/jpeg', quality);
          const size = estimateDataUrlBytes(compressed);
          
          if (size <= maxSizeBytes) {
            // Tìm được kết quả phù hợp!
            resolve(compressed);
            return;
          }
          
          // Lưu kết quả nhỏ nhất (gần với limit nhất)
          if (size < bestSize) {
            bestSize = size;
            bestResult = compressed;
          }
        }
      }
      
      // Nếu không tìm được kết quả phù hợp, trả về kết quả nhỏ nhất đã tìm được
      console.warn(`⚠️ Image still too large after compression: ${(bestSize / 1024).toFixed(1)} KB (limit: ${(maxSizeBytes / 1024).toFixed(1)} KB). Using best compressed version.`);
      resolve(bestResult);
    };
    img.onerror = () => {
      console.error('Failed to load image for compression');
      resolve(dataUrl); // Fallback to original nếu có lỗi
    };
    img.src = dataUrl;
  });
}

interface StreamPlateDetection {
  id: string;
  plateText: string;
  detectedAt: Date;
  confidence: number;
  inputImageUrl: string;
  annotatedImageUrl?: string;
  parkingId: string;
  cameraId: string;
}

type PlateResult = {
  text: string;
  confidence: number;
  bbox?: number[];
};

export function StreamHostPage() {
  const { user } = useAuth();
  const ownerId = user?.uid ?? null;

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null); // Video element cho file upload
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoFileRef = useRef<File | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const hasViewerConnectedRef = useRef<boolean>(false); // Track if viewer ever connected

  // State
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamSource, setStreamSource] = useState<StreamSource>('camera');
  const [parkingLotId, setParkingLotId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [parkingIdError, setParkingIdError] = useState<string | null>(null);
  const [cameraIdError, setCameraIdError] = useState<string | null>(null);
  const [availableParkings, setAvailableParkings] = useState<string[]>([]);
  const [availableCameras, setAvailableCameras] = useState<string[]>([]);
  const [hasVideoFile, setHasVideoFile] = useState(false);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  
  // Plate detection from stream
  const [streamDetections, setStreamDetections] = useState<StreamPlateDetection[]>([]);
  const [detectingPlate, setDetectingPlate] = useState(false);
  
  // Sort state
  const [sortBy, setSortBy] = useState<'order' | 'time' | 'plate' | 'confidence' | 'parkingId' | 'cameraId'>('order');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Fetch available parking lots and cameras from Firebase
  useEffect(() => {
    const loadCameras = async () => {
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
          
          result.data.forEach((record: DetectionRecord) => {
            if (record.parkingId) parkings.add(record.parkingId);
            if (record.cameraId) cameras.add(record.cameraId);
          });

          setAvailableParkings(Array.from(parkings).sort());
          setAvailableCameras(Array.from(cameras).sort());
        } else if (result.error) {
          // Có lỗi nhưng không nghiêm trọng - chỉ log, không hiển thị cho user
          console.warn('⚠️ Không thể load danh sách cameras từ Firebase:', result.error);
          console.warn('💡 Bạn vẫn có thể nhập thủ công Parking Lot ID và Camera ID');
        }
      } catch (err) {
        // Firebase error (e.g., blocked by ad blocker) - không chặn streaming
        console.warn('⚠️ Failed to load cameras from Firebase (có thể bị chặn bởi ad blocker):', err);
        console.warn('💡 Bạn vẫn có thể nhập thủ công Parking Lot ID và Camera ID');
        // Không set error để tránh hiển thị lỗi không cần thiết - vẫn cho phép nhập thủ công
      }
    };

    loadCameras();
  }, [ownerId]);

  // Validate parking lot ID (only show error if user has interacted)
  const validateParkingId = (value: string, showEmptyError: boolean = false) => {
    if (!value.trim()) {
      if (showEmptyError) {
        setParkingIdError('Parking Lot ID không được để trống');
      } else {
        setParkingIdError(null);
      }
      return false;
    }
    if (!PARKING_ID_REGEX.test(value.trim())) {
      setParkingIdError('Parking Lot ID chỉ được chứa chữ cái tiếng Anh và số, không dấu, không khoảng trắng');
      return false;
    }
    setParkingIdError(null);
    return true;
  };

  // Validate camera ID (only show error if user has interacted)
  const validateCameraId = (value: string, showEmptyError: boolean = false) => {
    if (!value.trim()) {
      if (showEmptyError) {
        setCameraIdError('Camera ID không được để trống');
      } else {
        setCameraIdError(null);
      }
      return false;
    }
    if (!PARKING_ID_REGEX.test(value.trim())) {
      setCameraIdError('Camera ID chỉ được chứa chữ cái tiếng Anh và số, không dấu, không khoảng trắng');
      return false;
    }
    setCameraIdError(null);
    return true;
  };

  // Handle parking lot ID change
  const handleParkingIdChange = (value: string) => {
    setParkingLotId(value);
    // Only validate format, don't show empty error while typing
    if (value.trim().length > 0) {
      validateParkingId(value, true);
    } else {
      setParkingIdError(null);
    }
  };

  // Handle camera ID change
  const handleCameraIdChange = (value: string) => {
    setCameraId(value);
    // Only validate format, don't show empty error while typing
    if (value.trim().length > 0) {
      validateCameraId(value, true);
    } else {
      setCameraIdError(null);
    }
  };

  // Handle video file selection
  const handleVideoFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setHasVideoFile(false);
      setVideoFileName(null);
      return;
    }

    if (!file.type.startsWith('video/')) {
      setError('File phải là video');
      setHasVideoFile(false);
      setVideoFileName(null);
      return;
    }

    videoFileRef.current = file;
    setHasVideoFile(true);
    setVideoFileName(file.name);
    const url = URL.createObjectURL(file);
    
    if (sourceVideoRef.current) {
      sourceVideoRef.current.src = url;
      sourceVideoRef.current.onloadedmetadata = () => {
        console.log('Video loaded:', file.name, sourceVideoRef.current?.duration);
      };
    }
  };

  // Get room ID from parking and camera
  const roomId = useMemo(() => {
    if (!parkingLotId.trim() || !cameraId.trim()) return null;
    return `${parkingLotId.trim()}__${cameraId.trim()}`;
  }, [parkingLotId, cameraId]);

  // Create MediaStream from video file (with loop)
  const createStreamFromVideo = (): Promise<MediaStream> => {
    return new Promise((resolve, reject) => {
      if (!sourceVideoRef.current) {
        reject(new Error('Video element not found'));
        return;
      }

      const video = sourceVideoRef.current;
      
      // Ensure video is ready
      if (video.readyState < 2) {
        video.onloadedmetadata = () => {
          createStream();
        };
        video.onerror = () => {
          reject(new Error('Failed to load video'));
        };
      } else {
        createStream();
      }

      function createStream() {
        // Ensure video dimensions are set
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          // Wait for video to have dimensions
          video.onloadedmetadata = () => {
            createStream();
          };
          return;
        }

        // Check if browser supports captureStream (Chrome, Edge)
        const videoWithCapture = video as HTMLVideoElement & { captureStream?: (frameRate?: number) => MediaStream };
        if (typeof videoWithCapture.captureStream === 'function') {
          console.log('Using captureStream() method');
          const stream = videoWithCapture.captureStream(30); // 30 FPS
          
          console.log('Stream created with tracks:', stream.getTracks().length);
          stream.getTracks().forEach((track) => {
            console.log('Track:', track.kind, track.id, track.enabled);
          });
          
          // Handle video loop
          video.onended = () => {
            console.log('Video ended, looping...');
            video.currentTime = 0;
            video.play();
          };
          
          // Ensure video is playing
          if (video.paused) {
            video.play().catch((err) => {
              console.error('Error playing video:', err);
            });
          }
          
          resolve(stream);
          return;
        }

        // Fallback: Use canvas to capture video frames (for browsers without captureStream)
        console.log('Using canvas fallback method');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log('Canvas size:', canvas.width, 'x', canvas.height);

        const stream = canvas.captureStream(30); // 30 FPS
        console.log('Canvas stream created with tracks:', stream.getTracks().length);

        let isDrawing = false;
        const drawFrame = () => {
          if (!isDrawing) return;
          
          if (video.ended || video.paused) {
            // Loop video
            video.currentTime = 0;
            video.play();
          }
          if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          requestAnimationFrame(drawFrame);
        };

        // Handle video loop
        video.onended = () => {
          console.log('Video ended, looping...');
          video.currentTime = 0;
          video.play();
        };

        // Start drawing
        video.play().then(() => {
          console.log('Video playing, starting canvas capture');
          isDrawing = true;
          drawFrame();
          resolve(stream);
        }).catch((err) => {
          reject(new Error(`Failed to play video: ${err.message}`));
        });
      }
    });
  };

  // Start streaming
  const connect = async () => {
    try {
      // Validate inputs (show errors if empty)
      const parkingValid = validateParkingId(parkingLotId, true);
      const cameraValid = validateCameraId(cameraId, true);
      
      if (!parkingValid || !cameraValid) {
        setError('Vui lòng kiểm tra lại thông tin nhập vào');
        return;
      }

      if (!roomId) {
        setError('Room ID không hợp lệ');
        return;
      }

      setStatus('connecting');
      setError(null);

      let stream: MediaStream;

      if (streamSource === 'camera') {
        // Get stream from camera with high quality constraints
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: HIGH_QUALITY_VIDEO_CONSTRAINTS,
            audio: true,
          });
        } catch (err) {
          // Fallback to medium quality if high quality fails
          console.warn('Failed to get high quality camera, trying medium quality:', err);
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 60 },
            },
            audio: true,
          });
        }
      } else {
        // Get stream from video file
        if (!videoFileRef.current || !sourceVideoRef.current) {
          setError('Vui lòng chọn video file');
          setStatus('error');
          return;
        }

        // Ensure video is configured for looping
        if (sourceVideoRef.current) {
          sourceVideoRef.current.loop = true;
          sourceVideoRef.current.muted = true;
          // Wait for video to be ready
          if (sourceVideoRef.current.readyState < 2) {
            await new Promise<void>((resolve, reject) => {
              const video = sourceVideoRef.current!;
              video.onloadedmetadata = () => resolve();
              video.onerror = () => reject(new Error('Failed to load video'));
            });
          }
        }

        stream = await createStreamFromVideo();
      }

      streamRef.current = stream;

      console.log('Stream created:', stream.id);
      console.log('Stream tracks:', stream.getTracks().length);
      stream.getTracks().forEach((track) => {
        console.log('Track:', track.kind, track.id, 'enabled:', track.enabled, 'readyState:', track.readyState);
      });

      // Show preview
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.error('Error playing preview:', err);
        });
      }

      // Create PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
      });

      // Thêm tracks vào PeerConnection và tối ưu
      stream.getTracks().forEach((track) => {
        // Tối ưu video track
        optimizeVideoTrack(track);
        pc.addTrack(track, stream);
        console.log('Added track to PeerConnection:', track.kind, track.id);
      });

      // Tối ưu video quality (bitrate, codec, resolution)
      await optimizeVideoQuality(pc);
      pcRef.current = pc;

      // Ghi log phiên stream vào Firestore (không chặn nếu lỗi)
      if (ownerId && roomId) {
        try {
          const result = await createStreamSession({
            ownerId,
            parkingId: parkingLotId.trim(),
            cameraId: cameraId.trim(),
            roomId,
            sourceType: streamSource,
            videoFileName: streamSource === 'video' ? videoFileRef.current?.name ?? null : null,
          });
          if (result.success && result.id) {
            streamSessionIdRef.current = result.id;
          }
        } catch (logError) {
          console.warn('Failed to create stream session log:', logError);
        }
      }

      // Connect WebSocket with timeout
      const socket = new WebSocket(SIGNALING_URL);
      socketRef.current = socket;

      // Set timeout for WebSocket connection
      const connectionTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          console.error('WebSocket connection timeout');
          setError('Không thể kết nối đến signaling server. Đảm bảo server đang chạy tại ws://localhost:3001');
          setStatus('error');
          socket.close();
        }
      }, 5000); // 5 seconds timeout

      socket.onopen = async () => {
        clearTimeout(connectionTimeout);
        console.log('✅ Connected to signaling server');
        socket.send(JSON.stringify({ type: 'join', role: 'host', roomId }));

        // Create offer with high quality codec preferences
        try {
          const offer = await createHighQualityOffer(pc);
          await pc.setLocalDescription(offer);
          socket.send(JSON.stringify({ type: 'offer', offer }));
          console.log('✅ High quality offer created and sent');
          
          // Host đã sẵn sàng stream ngay cả khi chưa có viewer
          setStatus('streaming');
          setError(null); // Clear any previous errors
          if (streamSessionIdRef.current) {
            updateStreamSessionStatus(streamSessionIdRef.current, 'active');
          }
        } catch (err) {
          console.error('Error creating offer:', err);
          setError('Lỗi tạo WebRTC offer');
          setStatus('error');
        }
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data.type);
          
          if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            hasViewerConnectedRef.current = true; // Đánh dấu đã có viewer kết nối
            console.log('✅ Received answer from viewer');
          } else if (data.type === 'ice') {
            await pc.addIceCandidate(data.candidate);
            console.log('✅ Added ICE candidate');
          }
        } catch (err) {
          console.error('Error handling message:', err);
        }
      };

      socket.onerror = (err) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', err);
        setError('Lỗi kết nối signaling server. Đảm bảo server đang chạy: cd server && npm start');
        setStatus('error');
      };

      socket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket closed', event.code, event.reason);
        if (status !== 'idle' && status !== 'error') {
          setStatus('idle');
          if (event.code !== 1000) {
            setError('Kết nối bị đóng. Code: ' + event.code);
          }
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ice', candidate: event.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        
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
          console.warn('⚠️ Viewer disconnected, but host continues streaming');
          setError(null); // Không hiển thị error, host vẫn tiếp tục stream
          // Giữ status = 'streaming' vì host vẫn đang stream, chỉ là không có viewer
        }
        // Nếu chưa có viewer, không làm gì - host vẫn stream bình thường
      };
    } catch (err: any) {
      console.error('Error starting stream:', err);
      setError(err.message || 'Không thể bắt đầu stream');
      setStatus('error');
    }
  };

  // Capture frame from video element to base64
  const captureFrameFromVideo = (): string | null => {
    if (!videoRef.current) {
      console.error('❌ Video element not found');
      return null;
    }
    
    const video = videoRef.current;
    
    // Check if video is ready
    if (video.readyState < 2) {
      console.warn('⚠️ Video not ready for capture. readyState:', video.readyState);
      return null;
    }
    
    // Check video dimensions
    const videoWidth = video.videoWidth || video.clientWidth;
    const videoHeight = video.videoHeight || video.clientHeight;
    
    if (videoWidth === 0 || videoHeight === 0) {
      console.error('❌ Video dimensions are zero:', { videoWidth, videoHeight });
      return null;
    }
    
    console.log('📸 Capturing frame:', { videoWidth, videoHeight, readyState: video.readyState });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('❌ Canvas context not available');
      return null;
    }
    
    // Set canvas dimensions to match video
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    // Draw current video frame to canvas
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      console.log('✅ Frame captured successfully');
    } catch (err) {
      console.error('❌ Error drawing video to canvas:', err);
      return null;
    }
    
    // Convert to base64 data URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    console.log('📸 Data URL length:', dataUrl.length, 'characters');
    
    return dataUrl;
  };

  // Handle capture and detect plate number
  const handleCaptureAndDetect = async () => {
    if (!ownerId || !parkingLotId.trim() || !cameraId.trim()) {
      setError('Vui lòng nhập Parking Lot ID và Camera ID trước khi detect');
      return;
    }
    
    if (!videoRef.current) {
      setError('Không tìm thấy video stream');
      return;
    }
    
    if (status !== 'streaming') {
      setError('Vui lòng bắt đầu stream trước khi detect');
      return;
    }
    
    setDetectingPlate(true);
    setError(null);
    
    try {
      // Capture frame from video
      const frameDataUrl = captureFrameFromVideo();
      if (!frameDataUrl) {
        throw new Error('Không thể capture frame từ video');
      }
      
      // Send to plate detection API
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/api/plate-detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: frameDataUrl }),
        });
      } catch (fetchError) {
        // Network error - server không chạy hoặc không thể kết nối
        console.error('Network error:', fetchError);
        throw new Error(
          `Không thể kết nối đến server detect biển số.\n` +
          `Đảm bảo server đang chạy tại: ${API_BASE}\n` +
          `Chạy lệnh: cd server && npm start`
        );
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Server trả về lỗi (${response.status})`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      // Log response để debug
      console.log('📥 API Response:', {
        success: data.success,
        platesCount: data.plates?.length || 0,
        hasAnnotatedImage: !!data.annotatedImage,
        error: data.error,
      });
      
      if (!data.success) {
        throw new Error(data.error || 'Plate detection failed');
      }
      
      const detectedPlates: PlateResult[] = data.plates || [];
      
      console.log('🔍 Detected plates:', detectedPlates);
      
      if (detectedPlates.length === 0) {
        setError('Không tìm thấy biển số nào trong frame này. Hãy thử capture lại hoặc đảm bảo biển số rõ ràng trong video.');
        setDetectingPlate(false);
        return;
      }
      
      // Filter plates với confidence thấp (dưới 10% - giảm threshold để dễ detect hơn)
      // Chỉ lọc bỏ text rỗng, không filter theo độ dài
      const validPlates = detectedPlates.filter(plate => {
        const conf = plate.confidence || 0;
        // Chỉ cần có text (không rỗng) và confidence >= 10%
        const hasValidText = plate.text && plate.text.trim().length > 0;
        return conf >= 0.1 && hasValidText;
      });
      
      if (validPlates.length === 0 && detectedPlates.length > 0) {
        // Có detect nhưng confidence thấp hoặc text không hợp lệ
        const platesInfo = detectedPlates.map(p => `${p.text || '(empty)'} (${((p.confidence || 0) * 100).toFixed(1)}%)`).join(', ');
        setError(`Tìm thấy ${detectedPlates.length} biển số nhưng không đủ tin cậy: ${platesInfo}. Hãy thử capture lại khi biển số rõ hơn.`);
        setDetectingPlate(false);
        return;
      }
      
      if (validPlates.length === 0) {
        // Hiển thị thông báo với thông tin debug
        let errorMsg = 'Không tìm thấy biển số nào trong frame này.\n';
        if (detectedPlates.length > 0) {
          errorMsg += `Model đã detect ${detectedPlates.length} kết quả nhưng không đủ điều kiện (confidence hoặc text không hợp lệ).\n`;
          errorMsg += `Chi tiết: ${detectedPlates.map(p => `"${p.text || '(rỗng)'}" (${((p.confidence || 0) * 100).toFixed(1)}%)`).join(', ')}`;
        } else {
          errorMsg += 'Hãy thử capture lại khi biển số rõ ràng và đầy đủ trong video.';
        }
        setError(errorMsg);
        setDetectingPlate(false);
        return;
      }
      
      console.log('✅ Valid plates (confidence >= 20%):', validPlates);
      
      // Compress input image trước khi lưu vào Firebase
      console.log('📦 Compressing input image for Firebase...');
      const compressedInputImage = await compressImageForFirestore(frameDataUrl, FIRESTORE_FIELD_LIMIT - DATA_URL_MARGIN, 1280, 720);
      
      console.log('📊 Image sizes:', {
        originalInput: `${(estimateDataUrlBytes(frameDataUrl) / 1024).toFixed(1)} KB`,
        compressedInput: `${(estimateDataUrlBytes(compressedInputImage) / 1024).toFixed(1)} KB`,
        annotatedImage: data.annotatedImage ? `${(estimateDataUrlBytes(data.annotatedImage) / 1024).toFixed(1)} KB` : 'N/A',
        note: 'Annotated image chỉ hiển thị trong UI, không lưu vào Firebase (quá lớn)',
      });
      
      // Save each detected plate to Firebase
      // NOTE: Không lưu annotatedImageUrl vào Firebase vì quá lớn (>1MB)
      // Annotated image chỉ được lưu trong local state để hiển thị trong UI
      const now = new Date();
      const savedDetections: StreamPlateDetection[] = [];
      
      // Sử dụng validPlates thay vì detectedPlates
      for (const plate of validPlates) {
        // Save to Firebase - CHỈ lưu inputImageUrl, KHÔNG lưu annotatedImageUrl
        const saveResult = await savePlateDetection({
          ownerId,
          parkingId: parkingLotId.trim(),
          cameraId: cameraId.trim(),
          plateText: plate.text,
          confidence: plate.confidence,
          inputImageUrl: compressedInputImage,
          // Không lưu annotatedImageUrl vào Firebase (quá lớn, vượt quá Firestore limit)
          annotatedImageUrl: undefined,
          rawResponse: data.raw,
        });
        
        if (saveResult.success) {
          const detection: StreamPlateDetection = {
            id: saveResult.id || `detection-${Date.now()}-${Math.random()}`,
            plateText: plate.text,
            detectedAt: now,
            confidence: plate.confidence,
            inputImageUrl: compressedInputImage,
            // Lưu annotated image trong local state để hiển thị (không lưu vào Firebase)
            annotatedImageUrl: data.annotatedImage || undefined,
            parkingId: parkingLotId.trim(),
            cameraId: cameraId.trim(),
          };
          savedDetections.push(detection);
          console.log(`✅ Saved plate detection: ${plate.text} (${(plate.confidence * 100).toFixed(1)}%)`);
        } else {
          console.error(`❌ Failed to save plate detection: ${plate.text}`, saveResult.error);
          // Vẫn thêm vào local state để hiển thị, dù không lưu được vào Firebase
          const detection: StreamPlateDetection = {
            id: `detection-${Date.now()}-${Math.random()}`,
            plateText: plate.text,
            detectedAt: now,
            confidence: plate.confidence,
            inputImageUrl: compressedInputImage,
            annotatedImageUrl: data.annotatedImage || undefined,
            parkingId: parkingLotId.trim(),
            cameraId: cameraId.trim(),
          };
          savedDetections.push(detection);
        }
      }
      
      // Add to local state (prepend to show latest first)
      if (savedDetections.length > 0) {
        setStreamDetections((prev) => [...savedDetections, ...prev]);
      }
      
    } catch (err) {
      console.error('Plate detection error:', err);
      setError(err instanceof Error ? err.message : 'Lỗi detect biển số');
    } finally {
      setDetectingPlate(false);
    }
  };

  // Disconnect and cleanup
  const disconnect = () => {
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    // Close PeerConnection
    if (pcRef.current) {
      pcRef.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      pcRef.current.close();
      pcRef.current = null;
    }

    // Close WebSocket
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    // Clear video elements
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (sourceVideoRef.current) {
      sourceVideoRef.current.pause();
      sourceVideoRef.current.src = '';
    }
    videoFileRef.current = null;
    setHasVideoFile(false);
    setVideoFileName(null);
    if (videoFileInputRef.current) {
      videoFileInputRef.current.value = '';
    }

    if (streamSessionIdRef.current) {
      updateStreamSessionStatus(streamSessionIdRef.current, 'ended');
      streamSessionIdRef.current = null;
    }

    hasViewerConnectedRef.current = false; // Reset viewer connection tracking
    setStatus('idle');
    setError(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const canStartStream = 
    parkingLotId.trim().length > 0 &&
    cameraId.trim().length > 0 &&
    !parkingIdError &&
    !cameraIdError &&
    (streamSource === 'camera' || (streamSource === 'video' && hasVideoFile));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold mb-4">🎥 Host Stream</h1>
        <p className="text-gray-600 mb-4">
          Phát trực tiếp video từ camera hoặc video file. Người xem có thể kết nối qua trang Viewer.
        </p>

        {/* Configuration Form */}
        <div className="mb-6 space-y-4 border-b pb-6">
          {/* Stream Source Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nguồn stream
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="streamSource"
                  value="camera"
                  checked={streamSource === 'camera'}
                  onChange={(e) => setStreamSource(e.target.value as StreamSource)}
                  className="mr-2"
                  disabled={status !== 'idle'}
                />
                <span>📷 Camera</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="streamSource"
                  value="video"
                  checked={streamSource === 'video'}
                  onChange={(e) => setStreamSource(e.target.value as StreamSource)}
                  className="mr-2"
                  disabled={status !== 'idle'}
                />
                <span>🎬 Video File</span>
              </label>
            </div>
          </div>

          {/* Parking Lot ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Parking Lot ID <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={parkingLotId}
                onChange={(e) => handleParkingIdChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={status !== 'idle'}
              >
                <option value="">-- Chọn hoặc nhập mới --</option>
                {availableParkings.map((parking) => (
                  <option key={parking} value={parking}>
                    {parking}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={parkingLotId}
                onChange={(e) => handleParkingIdChange(e.target.value)}
                placeholder="Nhập Parking Lot ID"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={status !== 'idle'}
              />
            </div>
            {parkingIdError && (
              <p className="mt-1 text-sm text-red-600">{parkingIdError}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              ID chỉ gồm chữ cái tiếng Anh và số, không dấu và không khoảng trắng
            </p>
          </div>

          {/* Camera ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Camera ID <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={cameraId}
                onChange={(e) => handleCameraIdChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={status !== 'idle'}
              >
                <option value="">-- Chọn hoặc nhập mới --</option>
                {availableCameras.map((camera) => (
                  <option key={camera} value={camera}>
                    {camera}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={cameraId}
                onChange={(e) => handleCameraIdChange(e.target.value)}
                placeholder="Nhập Camera ID"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={status !== 'idle'}
              />
            </div>
            {cameraIdError && (
              <p className="mt-1 text-sm text-red-600">{cameraIdError}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              ID chỉ gồm chữ cái tiếng Anh và số, không dấu và không khoảng trắng
            </p>
          </div>

          {/* Video File Upload (only when source is video) */}
          {streamSource === 'video' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Video File <span className="text-red-500">*</span>
              </label>
              <input
                type="file"
                accept="video/*"
                ref={videoFileInputRef}
                onChange={handleVideoFileSelect}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={status !== 'idle'}
              />
              <p className="mt-1 text-xs text-gray-500">
                Video sẽ được phát lặp lại liên tục
              </p>
              {hasVideoFile && videoFileName && (
                <p className="mt-1 text-xs text-green-600">
                  ✅ Đã chọn: <span className="font-semibold">{videoFileName}</span>
                </p>
              )}
              {/* Hidden video element for file playback */}
              <video
                ref={sourceVideoRef}
                loop
                muted
                playsInline
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Video Preview */}
        <div className="mb-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black aspect-video"
          />
        </div>

        {/* Controls */}
        <div className="flex gap-3 flex-wrap">
          {status === 'idle' && (
            <button
              onClick={connect}
              disabled={!canStartStream}
              className={`px-6 py-2 rounded-lg transition ${
                canStartStream
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Bắt đầu phát
            </button>
          )}
          {status !== 'idle' && (
            <>
              <button
                onClick={disconnect}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
              >
                Dừng phát
              </button>
              <button
                onClick={handleCaptureAndDetect}
                disabled={detectingPlate || !ownerId || !parkingLotId.trim() || !cameraId.trim()}
                className={`px-6 py-2 rounded-lg transition ${
                  detectingPlate || !ownerId || !parkingLotId.trim() || !cameraId.trim()
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {detectingPlate ? '⏳ Đang detect...' : '📸 Capture & Detect Biển Số'}
              </button>
            </>
          )}
        </div>

        {/* Help message when button is disabled */}
        {status === 'idle' && !canStartStream && (
          <div className="mt-2 text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
            <strong>💡 Để bắt đầu phát, vui lòng:</strong>
            <ul className="mt-1 ml-4 list-disc space-y-1">
              {parkingLotId.trim().length === 0 && (
                <li>Nhập hoặc chọn Parking Lot ID</li>
              )}
              {cameraId.trim().length === 0 && (
                <li>Nhập hoặc chọn Camera ID</li>
              )}
              {parkingIdError && <li>Sửa lỗi Parking Lot ID: {parkingIdError}</li>}
              {cameraIdError && <li>Sửa lỗi Camera ID: {cameraIdError}</li>}
              {streamSource === 'video' && !videoFileRef.current && (
                <li>Chọn video file để phát</li>
              )}
            </ul>
          </div>
        )}

        {/* Status */}
        <div className="mt-4">
          <div className="text-sm text-gray-600">
            <strong>Trạng thái:</strong>{' '}
            <span
              className={`font-semibold ${
                status === 'streaming'
                  ? 'text-green-600'
                  : status === 'connecting'
                    ? 'text-yellow-600'
                    : status === 'error'
                      ? 'text-red-600'
                      : 'text-gray-500'
              }`}
            >
              {status === 'idle' && 'Chưa kết nối'}
              {status === 'connecting' && 'Đang kết nối...'}
              {status === 'streaming' && '✅ Đang phát'}
              {status === 'error' && '❌ Lỗi'}
            </span>
          </div>
          {error && (
            <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
          )}
          {roomId && (
            <div className="mt-2 text-xs text-gray-500">
              Room ID: <code className="bg-gray-100 px-2 py-1 rounded">{roomId}</code>
            </div>
          )}
        </div>

        {/* Plate Detection Results Table */}
        {status === 'streaming' && (
          <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                📋 Kết quả Detect Biển Số từ Stream
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Bấm nút "Capture & Detect Biển Số" để chụp frame và detect biển số
              </p>
            </div>
            
            {streamDetections.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>Chưa có kết quả detect nào.</p>
                <p className="text-sm mt-2">Bấm nút "Capture & Detect Biển Số" để bắt đầu.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'order') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('order');
                            setSortOrder('desc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          Thứ tự
                          {sortBy === 'order' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'time') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('time');
                            setSortOrder('desc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          Thời gian Detect
                          {sortBy === 'time' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'plate') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('plate');
                            setSortOrder('asc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          Biển Số
                          {sortBy === 'plate' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'parkingId') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('parkingId');
                            setSortOrder('asc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          ID Bãi
                          {sortBy === 'parkingId' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'cameraId') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('cameraId');
                            setSortOrder('asc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          ID Cam
                          {sortBy === 'cameraId' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => {
                          if (sortBy === 'confidence') {
                            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortBy('confidence');
                            setSortOrder('desc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          Độ tin cậy
                          {sortBy === 'confidence' && (
                            <span className="text-indigo-600">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {[...streamDetections]
                      .sort((a, b) => {
                        let comparison = 0;
                        
                        switch (sortBy) {
                          case 'order':
                            // Sort by original index (newest first = highest index)
                            const indexA = streamDetections.indexOf(a);
                            const indexB = streamDetections.indexOf(b);
                            comparison = indexB - indexA; // Higher index = newer = first
                            break;
                          case 'time':
                            comparison = a.detectedAt.getTime() - b.detectedAt.getTime();
                            break;
                          case 'plate':
                            comparison = a.plateText.localeCompare(b.plateText);
                            break;
                          case 'parkingId':
                            comparison = a.parkingId.localeCompare(b.parkingId);
                            break;
                          case 'cameraId':
                            comparison = a.cameraId.localeCompare(b.cameraId);
                            break;
                          case 'confidence':
                            comparison = a.confidence - b.confidence;
                            break;
                        }
                        
                        return sortOrder === 'asc' ? comparison : -comparison;
                      })
                      .map((detection) => {
                        // Calculate original index for order display
                        const originalIndex = streamDetections.length - streamDetections.indexOf(detection);
                        return (
                          <tr key={detection.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {originalIndex}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {detection.detectedAt.toLocaleString('vi-VN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm font-mono font-bold text-gray-900 uppercase tracking-wider">
                                {detection.plateText}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <code className="bg-gray-100 px-2 py-1 rounded text-xs font-mono">
                                {detection.parkingId}
                              </code>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <code className="bg-gray-100 px-2 py-1 rounded text-xs font-mono">
                                {detection.cameraId}
                              </code>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {(detection.confidence * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
