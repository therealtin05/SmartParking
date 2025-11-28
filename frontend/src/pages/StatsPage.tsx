import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchDetections } from '../services/detectionService';

export function StatsPage() {
  const { user } = useAuth();
  const ownerId = user?.uid ?? null;
  const [stats, setStats] = useState({
    totalDetections: 0,
    totalVehicles: 0,
    avgVehicles: 0
  });
  
  useEffect(() => {
    const fetchStats = async () => {
      if (!ownerId) {
        setStats({ totalDetections: 0, totalVehicles: 0, avgVehicles: 0 });
        return;
      }
      const result = await fetchDetections({ ownerId });
      if (!result.success || !result.data) {
        setStats({ totalDetections: 0, totalVehicles: 0, avgVehicles: 0 });
        return;
      }
      const totalDetections = result.data.length;
      const totalVehicles = result.data.reduce((sum, record) => sum + (record.vehicleCount || 0), 0);
      const avgVehicles = totalDetections > 0 ? totalVehicles / totalDetections : 0;
      setStats({ totalDetections, totalVehicles, avgVehicles });
    };
    
    fetchStats();
  }, [ownerId]);
  
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">📈 Statistics</h1>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="p-6 bg-blue-50 rounded-lg">
          <div className="text-4xl font-bold text-blue-600">
            {stats.totalDetections}
          </div>
          <div className="text-gray-600">Total Detections</div>
        </div>
        
        <div className="p-6 bg-green-50 rounded-lg">
          <div className="text-4xl font-bold text-green-600">
            {stats.totalVehicles}
          </div>
          <div className="text-gray-600">Total Vehicles</div>
        </div>
        
        <div className="p-6 bg-purple-50 rounded-lg">
          <div className="text-4xl font-bold text-purple-600">
            {stats.avgVehicles.toFixed(1)}
          </div>
          <div className="text-gray-600">Avg Vehicles/Detection</div>
        </div>
      </div>
    </div>
  );
}