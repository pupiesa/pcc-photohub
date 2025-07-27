"use client"
import { useState, useRef } from 'react';

export default function Home() {
  const [status, setStatus] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const handleCapture = async () => {
    setIsCapturing(true);
    setStatus('📸 Capturing photo...');
    
    try {
      const res = await fetch('http://192.168.0.117:5000/capture');
      const data = await res.json();
      
      if (data.status === 'success') {
        setStatus('✅ Photo Captured!');
        setImagePath(data.filename);
        // Force preview refresh
        setPreviewKey(prev => prev + 1);
      } else {
        setStatus('❌ Capture failed: ' + data.message);
      }
    } catch (err) {
      setStatus('❌ Failed to capture: ' + err.message);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div style={{ textAlign: 'center', paddingTop: '50px' }}>
      <h1>📸 Photo Booth</h1>
      
      {/* Live Preview */}
      <div style={{ 
        border: '2px solid #ccc', 
        borderRadius: '10px', 
        overflow: 'hidden',
        marginBottom: '20px',
        display: 'inline-block'
      }}>
        {!isCapturing ? (
          <img 
            key={previewKey}
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
        ) : (
          <div style={{
            width: '640px',
            height: '480px',
            backgroundColor: '#f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            color: '#666',
            flexDirection: 'column'
          }}>
            <div style={{ fontSize: '48px' }}>📸</div>
            <div style={{ fontSize: '18px', marginTop: '10px' }}>
              Capturing Photo...
            </div>
          </div>
        )}
      </div>

      <br />
      
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
          marginBottom: '20px'
        }}
      >
        {isCapturing ? '📸 Capturing...' : '📸 Take Photo'}
      </button>
      
      <p style={{ fontSize: '16px', margin: '10px 0' }}>{status}</p>
      
      {imagePath && (
        <div style={{ marginTop: '20px' }}>
          <h3>Last Captured Photo:</h3>
          <img 
            src={`http://192.168.0.117:5000/static/${imagePath}`}
            width="400" 
            style={{ 
              border: '2px solid #28a745',
              borderRadius: '10px'
            }}
          />
        </div>
      )}
    </div>
  );
}