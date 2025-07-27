'use client';
import { useState } from 'react';

export default function PhotoBooth() {
  const [status, setStatus] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = async () => {
    setIsCapturing(true);
    setStatus('📸 Capturing...');
    
    try {
      const res = await fetch('http://192.168.0.117:5000/capture');
      const data = await res.json();
      
      if (data.status === 'success') {
        setStatus('✅ Photo Captured!');
        setImagePath(data.path);
      } else {
        setStatus('❌ Capture failed: ' + data.message);
      }
    } catch (err) {
      setStatus('❌ Failed to capture: ' + err.message);
    } finally {
      setIsCapturing(false);
    }
  };

  const checkCameraStatus = async () => {
    try {
      const res = await fetch('http://192.168.0.117:5000/status');
      const data = await res.json();
      setStatus(data.status === 'ready' ? '📷 Camera Ready' : '❌ Camera Error');
    } catch (err) {
      setStatus('❌ Camera Offline');
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ marginBottom: '30px' }}>📸 PCC Photo Hub</h1>
      
      {/* Live Preview */}
      <div style={{ 
        border: '2px solid #ccc', 
        borderRadius: '10px', 
        overflow: 'hidden',
        marginBottom: '20px'
      }}>
        <img 
          src="http://192.168.0.117:5000/preview" 
          alt="Camera Preview"
          style={{ 
            width: '640px', 
            height: '480px',
            objectFit: 'cover'
          }}
          onError={(e) => {
            e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQ4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIFByZXZpZXcgQXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg==';
          }}
        />
      </div>

      {/* Control Buttons */}
      <div style={{ 
        display: 'flex', 
        gap: '15px', 
        marginBottom: '20px' 
      }}>
        <button 
          onClick={handleCapture}
          disabled={isCapturing}
          style={{
            padding: '15px 30px',
            fontSize: '18px',
            backgroundColor: isCapturing ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isCapturing ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.3s'
          }}
        >
          {isCapturing ? '📸 Capturing...' : '📸 Capture Photo'}
        </button>

        <button 
          onClick={checkCameraStatus}
          style={{
            padding: '15px 20px',
            fontSize: '16px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          🔍 Check Camera
        </button>
      </div>

      {/* Status Display */}
      {status && (
        <div style={{ 
          padding: '10px 20px',
          marginBottom: '20px',
          backgroundColor: status.includes('✅') ? '#d4edda' : '#f8d7da',
          color: status.includes('✅') ? '#155724' : '#721c24',
          borderRadius: '5px',
          fontSize: '16px'
        }}>
          {status}
        </div>
      )}

      {/* Captured Image Display */}
      {imagePath && (
        <div style={{ marginTop: '20px' }}>
          <h3>Last Captured Photo:</h3>
          <div style={{ 
            border: '2px solid #007bff', 
            borderRadius: '10px', 
            overflow: 'hidden',
            display: 'inline-block'
          }}>
            <img 
              src={`http://192.168.0.117:5000/static/${imagePath.split('/').pop()}`}
              alt="Captured"
              style={{ 
                maxWidth: '400px',
                maxHeight: '300px',
                objectFit: 'contain'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}