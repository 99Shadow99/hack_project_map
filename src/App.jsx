import { useState } from 'react';
import { MapContainer, TileLayer, Circle, Popup, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DynamicRoadRouting from './components/DynamicRoadRouting';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <header style={{
        position: 'sticky',
        top: 0,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        zIndex: 10,
        padding: '1rem',
        fontWeight: 'bold',
        fontSize: '1.5rem',
        color: 'white',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        textAlign: 'center'
      }}>
        🗺️ Simhastha 2028 Smart Pilgrim Route Planner
      </header>
      <div style={{ width: '100%', height: 'calc(100vh - 64px)' }}>
        <ErrorBoundary>
          <DynamicRoadRouting />
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
