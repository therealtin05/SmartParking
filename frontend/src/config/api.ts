// API Configuration
export const API_CONFIG = {
    // FastAPI backend
    baseURL: 'http://localhost:8000',
    
    // ESP32 stream endpoint (qua FastAPI proxy)
    streamURL: 'http://localhost:8000/stream',
    
    // API endpoints
    endpoints: {
      health: '/health',
      plateDetect: '/api/plate-detect',
      objectTracking: '/api/object-tracking',
      esp32Snapshot: '/api/esp32/snapshot',
      testESP32: '/test/esp32',
    }
  };