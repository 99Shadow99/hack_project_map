import { useState, useCallback, useEffect } from 'react';

import { MapContainer, TileLayer, Circle, Popup, Marker, useMapEvents, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Dynamic population grid with crowd analysis
class DynamicPopulationGrid {
  constructor() {
    this.populations = new Map();
    this.gridSize = 0.0005;
    this.crowdZones = [];
  }

  getGridKey(lat, lng) {
    const gridLat = Math.floor(lat / this.gridSize) * this.gridSize;
    const gridLng = Math.floor(lng / this.gridSize) * this.gridSize;
    return `${gridLat},${gridLng}`;
  }

  addPerson(lat, lng, count = 1) {
    const key = this.getGridKey(lat, lng);
    const current = this.populations.get(key) || 0;
    this.populations.set(key, current + count);

    // Update crowd zones
    this.updateCrowdZones();

    return current + count;
  }

  getPopulation(lat, lng) {
    const key = this.getGridKey(lat, lng);
    return this.populations.get(key) || 0;
  }

  getPopulatedAreas() {
    const areas = [];
    for (const [key, population] of this.populations) {
      if (population > 0) {
        const [lat, lng] = key.split(',').map(Number);
        areas.push({ lat, lng, population });
      }
    }
    return areas;
  }

  clearAll() {
    this.populations.clear();
    this.crowdZones = [];
  }

  getRoutingWeight(lat, lng) {
    const population = this.getPopulation(lat, lng);
    if (population === 0) return 1;
    if (population < 3) return 2;
    if (population < 6) return 5;
    if (population < 10) return 10;
    return 20;
  }

  // Update crowd zones for routing
  updateCrowdZones() {
    this.crowdZones = [];
    const areas = this.getPopulatedAreas();

    // Group nearby crowded areas
    for (const area of areas) {
      if (area.population >= 3) { // Only consider significant crowds
        this.crowdZones.push({
          center: [area.lat, area.lng],
          radius: Math.max(0.001, area.population * 0.0003),
          population: area.population,
          weight: this.getRoutingWeight(area.lat, area.lng)
        });
      }
    }
  }

  // Check if a point is in any crowd zone
  isPointInCrowdZone(point) {
    for (const zone of this.crowdZones) {
      const distance = Math.sqrt(
        Math.pow(point[0] - zone.center[0], 2) +
        Math.pow(point[1] - zone.center[1], 2)
      );
      if (distance <= zone.radius) {
        return zone;
      }
    }
    return null;
  }

  // Get crowd zones that intersect with a route
  getCrowdZonesOnRoute(route) {
    const intersectingZones = [];

    for (const point of route) {
      const zone = this.isPointInCrowdZone(point);
      if (zone && !intersectingZones.includes(zone)) {
        intersectingZones.push(zone);
      }
    }

    return intersectingZones;
  }
}

// Advanced OSRM Router with dynamic crowd avoidance
class DynamicOSRMRouter {
  constructor() {
    this.baseUrl = 'https://router.project-osrm.org';
  }

  // Get multiple route options
  async getMultipleRoutes(start, end, crowdZones = []) {
    const routes = [];

    try {
      // Route 1: Direct route
      const directRoute = await this.getRoadRoute(start, end);
      if (directRoute) {
        routes.push({
          route: directRoute,
          type: 'direct',
          crowdIntersections: this.analyzeCrowdIntersections(directRoute, crowdZones)
        });
      }

      // Route 2: Avoidance route with waypoints
      if (crowdZones.length > 0) {
        const avoidanceRoute = await this.getAvoidanceRoute(start, end, crowdZones);
        if (avoidanceRoute) {
          routes.push({
            route: avoidanceRoute,
            type: 'avoidance',
            crowdIntersections: this.analyzeCrowdIntersections(avoidanceRoute, crowdZones)
          });
        }
      }

      // Route 3: Alternative route (if OSRM supports it)
      const alternativeRoute = await this.getAlternativeRoute(start, end);
      if (alternativeRoute) {
        routes.push({
          route: alternativeRoute,
          type: 'alternative',
          crowdIntersections: this.analyzeCrowdIntersections(alternativeRoute, crowdZones)
        });
      }

      return routes;
    } catch (error) {
      console.error('Error getting multiple routes:', error);
      return [];
    }
  }

  // Analyze how much a route intersects with crowd zones
  analyzeCrowdIntersections(route, crowdZones) {
    let totalIntersection = 0;
    let worstZone = null;

    for (const zone of crowdZones) {
      let intersectionPoints = 0;

      for (const point of route) {
        const distance = Math.sqrt(
          Math.pow(point[0] - zone.center[0], 2) +
          Math.pow(point[1] - zone.center[1], 2)
        );
        if (distance <= zone.radius) {
          intersectionPoints++;
        }
      }

      const intersectionRatio = intersectionPoints / route.length;
      totalIntersection += intersectionRatio * zone.weight;

      if (!worstZone || intersectionRatio > worstZone.intersectionRatio) {
        worstZone = {
          zone,
          intersectionRatio,
          intersectionPoints
        };
      }
    }

    return {
      totalIntersection,
      worstZone,
      averageIntersection: totalIntersection / crowdZones.length || 0
    };
  }

  // Get direct road route
  async getRoadRoute(start, end) {
    try {
      const coordinates = [
        [start[1], start[0]], // [lng, lat]
        [end[1], end[0]]
      ];

      const coordsString = coordinates.map(coord => coord.join(',')).join(';');
      const url = `${this.baseUrl}/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.code !== 'Ok') {
        throw new Error(`OSRM Error: ${data.message}`);
      }

      const route = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      return route;

    } catch (error) {
      console.error('❌ OSRM routing failed:', error);
      return null;
    }
  }

  // Get route with avoidance waypoints
  async getAvoidanceRoute(start, end, crowdZones) {
    try {
      // Find the worst crowd zone
      const worstZone = crowdZones.reduce((worst, current) =>
        current.weight > worst.weight ? current : worst
      );

      // Create avoidance waypoints
      const avoidancePoints = this.createAvoidanceWaypoints(start, end, worstZone);

      // Build route with waypoints
      const coordinates = [
        [start[1], start[0]], // [lng, lat]
        ...avoidancePoints.map(point => [point[1], point[0]]),
        [end[1], end[0]]
      ];

      const coordsString = coordinates.map(coord => coord.join(',')).join(';');
      const url = `${this.baseUrl}/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.code !== 'Ok') {
        throw new Error(`OSRM Error: ${data.message}`);
      }

      const route = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      return route;

    } catch (error) {
      console.error('❌ OSRM avoidance routing failed:', error);
      return null;
    }
  }

  // Create waypoints to avoid crowd zones
  createAvoidanceWaypoints(start, end, crowdZone) {
    const waypoints = [];

    // Calculate perpendicular direction
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return waypoints;

    const perpX = -dy / length;
    const perpY = dx / length;

    // Create avoidance points at different distances
    const avoidanceDistances = [0.002, 0.004, 0.006]; // Different avoidance levels

    for (const distance of avoidanceDistances) {
      const avoidPoint = [
        crowdZone.center[0] + perpX * distance,
        crowdZone.center[1] + perpY * distance
      ];
      waypoints.push(avoidPoint);
    }

    return waypoints;
  }

  // Get alternative route
  async getAlternativeRoute(start, end) {
    try {
      const coordinates = [
        [start[1], start[0]], // [lng, lat]
        [end[1], end[0]]
      ];

      const coordsString = coordinates.map(coord => coord.join(',')).join(';');
      const url = `${this.baseUrl}/route/v1/driving/${coordsString}?overview=full&geometries=geojson&alternatives=true`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes[1]) {
        return null;
      }

      const route = data.routes[1].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      return route;

    } catch (error) {
      console.error('❌ OSRM alternative routing failed:', error);
      return null;
    }
  }
}

function MapClickHandler({ onSelect, onAddPerson }) {
  useMapEvents({
    click(e) {
      onSelect([e.latlng.lat, e.latlng.lng]);
    },
    contextmenu(e) {
      e.originalEvent.preventDefault();
      onAddPerson(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function DynamicRoadRouting() {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [currentRoute, setCurrentRoute] = useState([]);
  const [populationGrid] = useState(() => new DynamicPopulationGrid());
  const [populatedAreas, setPopulatedAreas] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const [router] = useState(() => new DynamicOSRMRouter());
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  // Center on Ujjain
  const center = [23.1821, 75.7890];

  // --- Static population data for initial crowds ---
  // If you want static population data to show on map load, use this useEffect.
  // If you do not want static data, comment out this block.
  // NOTE: If you set count: 0, that area will NOT show on the map (see getPopulatedAreas).
  //       Use count >= 1 for visible circles.
  const staticCrowdData = [
    { lat: 23.1821, lng: 75.7890, count: 20 },
    { lat: 23.1823, lng: 75.7892, count: 40 },
    { lat: 23.1830, lng: 75.7885, count: 0 }, // This will NOT show (count is 0)
    { lat: 23.1815, lng: 75.7870, count: 5 },
    { lat: 23.1829, lng: 75.7905, count: 8 }
  ];

  useEffect(() => {
    // Delay ensures map and leaflet are initialized before adding data
    setTimeout(() => {
      staticCrowdData.forEach(({ lat, lng, count }) => {
        // Only add if count > 0, otherwise it will not show
        if (count > 0) {
          populationGrid.addPerson(lat, lng, count);
        }
      });
      setPopulatedAreas(populationGrid.getPopulatedAreas());
      setDebugInfo('✅ Static population data loaded');
    }, 100);
    // eslint-disable-next-line
  }, [populationGrid]);
  // --- End static population data ---

  // Add person to a location (right-click)
  const handleAddPerson = useCallback((lat, lng) => {
    if (typeof lat !== 'number' || typeof lng !== 'number' ||
      isNaN(lat) || isNaN(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.error('Invalid coordinates:', { lat, lng });
      return;
    }

    const newPopulation = populationGrid.addPerson(lat, lng);
    setPopulatedAreas(populationGrid.getPopulatedAreas());
    console.log(`👥 Added person at (${lat}, ${lng}). New population: ${newPopulation}`);
  }, [populationGrid]);

  // Calculate dynamic route with multiple options
  const calculateRoute = useCallback(async () => {
    if (!start || !end) return;

    setIsCalculating(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('🔍 Starting dynamic road routing...');
      console.log('📍 Start:', start);
      console.log('🎯 End:', end);
      console.log('👥 Crowd zones:', populationGrid.crowdZones.length);

      setDebugInfo('🔍 Calculating dynamic routes...');

      // Get multiple route options
      const routes = await router.getMultipleRoutes(start, end, populationGrid.crowdZones);

      if (routes.length > 0) {
        console.log('🛣️ Found', routes.length, 'route options');
        setRouteOptions(routes);

        // Select the best route (lowest crowd intersection)
        const bestRoute = routes.reduce((best, current) =>
          current.crowdIntersections.totalIntersection < best.crowdIntersections.totalIntersection ? current : best
        );

        setCurrentRoute(bestRoute.route);
        setSelectedRouteIndex(routes.indexOf(bestRoute));
        setDebugInfo(`✅ Best route selected (${bestRoute.type}) with ${bestRoute.route.length} points`);

        // Calculate route statistics
        const totalPoints = bestRoute.route.length;
        const crowdedPoints = bestRoute.route.filter(point =>
          populationGrid.getRoutingWeight(point[0], point[1]) > 2
        ).length;

        const averageWeight = bestRoute.route.length > 0 ? bestRoute.route.reduce((sum, point) =>
          sum + populationGrid.getRoutingWeight(point[0], point[1]), 0
        ) / bestRoute.route.length : 0;

        const totalDistance = bestRoute.route.reduce((sum, point, i) => {
          if (i === 0) return 0;
          const prev = bestRoute.route[i - 1];
          const distance = Math.sqrt(
            Math.pow(point[0] - prev[0], 2) + Math.pow(point[1] - prev[1], 2)
          ) * 111000;
          return sum + distance;
        }, 0);

        setRouteInfo({
          totalPoints,
          crowdedPoints,
          averageWeight,
          totalDistance,
          efficiency: totalPoints > 0 ? Math.max(0, 100 - (crowdedPoints / totalPoints * 100)) : 0,
          routeType: bestRoute.type,
          crowdIntersection: bestRoute.crowdIntersections.totalIntersection
        });
      } else {
        setDebugInfo('❌ No routes found');
        setCurrentRoute([]);
        setRouteInfo(null);
      }
    } catch (error) {
      console.error('Error calculating route:', error);
      setCurrentRoute([]);
      setRouteInfo(null);
      setDebugInfo('❌ Error calculating route');
    } finally {
      setIsCalculating(false);
    }
  }, [start, end, populationGrid, router]);

  // Handle map click
  const handleSelect = useCallback((latlng) => {
    if (!latlng || typeof latlng[0] !== 'number' || typeof latlng[1] !== 'number' ||
      isNaN(latlng[0]) || isNaN(latlng[1]) ||
      latlng[0] < -90 || latlng[0] > 90 || latlng[1] < -180 || latlng[1] > 180) {
      console.error('Invalid coordinates:', latlng);
      return;
    }

    if (!start) {
      setStart(latlng);
      setEnd(null);
      setCurrentRoute([]);
      setRouteInfo(null);
      setRouteOptions([]);
      setDebugInfo('📍 Start point set');
    } else if (!end) {
      setEnd(latlng);
      setDebugInfo('🎯 End point set');
    } else {
      setStart(latlng);
      setEnd(null);
      setCurrentRoute([]);
      setRouteInfo(null);
      setRouteOptions([]);
      setDebugInfo('🔄 Reset to start point');
    }
  }, [start]);

  // Get color based on population density
  const getPopulationColor = (population) => {
    if (population === 0) return 'transparent';
    if (population < 3) return 'green';
    else if (population < 6) return 'orange';
    else if (population < 10) return 'red';
    else return 'darkred';
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Modern Instructions Panel */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        background: 'rgba(255, 255, 255, 0.98)',
        padding: '20px',
        borderRadius: '12px',
        fontSize: '14px',
        zIndex: 1000,
        maxWidth: '300px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#1f2937', fontSize: '16px' }}>
          🛣️ Dynamic Road Router
        </h3>
        <div style={{ lineHeight: '1.6', color: '#4b5563' }}>
          <div style={{ marginBottom: '8px' }}>
            <strong>📍 Set Route:</strong> Left-click to set start/end points
          </div>
          <div style={{ marginBottom: '8px' }}>
            <strong>👥 Add Crowd:</strong> Right-click to add people
          </div>
          <div style={{ marginBottom: '8px' }}>
            <strong>🛣️ Calculate:</strong> Multiple route options with crowd avoidance
          </div>
          <div style={{ marginBottom: '0' }}>
            <strong>📊 View:</strong> Best route selection & analysis
          </div>
        </div>
      </div>

      {/* Route Options Panel */}
      {routeOptions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 20,
          right: 20,
          background: 'rgba(255, 255, 255, 0.98)',
          padding: '20px',
          borderRadius: '12px',
          fontSize: '14px',
          zIndex: 1000,
          maxWidth: '300px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#1f2937', fontSize: '16px' }}>
            🛣️ Route Options
          </h3>
          {routeOptions.map((option, index) => (
            <div
              key={index}
              style={{
                padding: '10px',
                margin: '5px 0',
                borderRadius: '8px',
                background: selectedRouteIndex === index ? '#dbeafe' : '#f3f4f6',
                border: selectedRouteIndex === index ? '2px solid #2563eb' : '1px solid #e5e7eb',
                cursor: 'pointer'
              }}
              onClick={() => {
                setSelectedRouteIndex(index);
                setCurrentRoute(option.route);
                setDebugInfo(`✅ Selected ${option.type} route`);
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                {option.type.charAt(0).toUpperCase() + option.type.slice(1)} Route
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                Points: {option.route.length} | 
                Crowd: {option.crowdIntersections.totalIntersection.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modern Controls */}
      <div style={{
        position: 'absolute',
        top: routeOptions.length > 0 ? 280 : 20,
        right: 20,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {start && end && (
          <button
            disabled={isCalculating}
            style={{
              background: isCalculating ? '#9ca3af' : '#2563eb',
              color: 'white',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: isCalculating ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
              transition: 'all 0.2s ease'
            }}
            onClick={calculateRoute}
          >
            {isCalculating ? '🔄 Finding Routes...' : '🛣️ Calculate Routes'}
          </button>
        )}

        <button
          style={{
            background: '#dc2626',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 2px 8px rgba(220, 38, 38, 0.3)',
            transition: 'all 0.2s ease'
          }}
          onClick={() => {
            populationGrid.clearAll();
            setPopulatedAreas([]);
            setCurrentRoute([]);
            setRouteInfo(null);
            setRouteOptions([]);
            setDebugInfo('');
          }}
        >
          🗑️ Clear All
        </button>

        <button
          style={{
            background: '#059669',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
            transition: 'all 0.2s ease'
          }}
          onClick={() => {
            const testCrowdData = [
              { lat: 23.1821, lng: 75.7890, count: 3 },
              { lat: 23.1823, lng: 75.7892, count: 7 },
              { lat: 23.1830, lng: 75.7885, count: 10 },
              { lat: 23.1815, lng: 75.7870, count: 5 },
              { lat: 23.1829, lng: 75.7905, count: 8 }
            ];

            testCrowdData.forEach(({ lat, lng, count }) => {
              populationGrid.addPerson(lat, lng, count);
            });

            setPopulatedAreas(populationGrid.getPopulatedAreas());
            setDebugInfo('🧪 Loaded static test crowds');
          }}
        >
          🧪 Add Test Crowds
        </button>
      </div>

      {/* Modern Route Info Panel */}
      {routeInfo && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          background: 'rgba(255, 255, 255, 0.98)',
          padding: '20px',
          borderRadius: '12px',
          fontSize: '14px',
          zIndex: 1000,
          maxWidth: '350px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#1f2937', fontSize: '16px' }}>
            📊 Dynamic Route Analysis
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
            <div>
              <strong>Route Type:</strong><br />
              <span style={{ color: '#6b7280' }}>{routeInfo.routeType}</span>
            </div>
            <div>
              <strong>Crowd Intersection:</strong><br />
              <span style={{ color: '#dc2626' }}>{routeInfo.crowdIntersection.toFixed(2)}</span>
            </div>
            <div>
              <strong>Route Points:</strong><br />
              <span style={{ color: '#6b7280' }}>{routeInfo.totalPoints}</span>
            </div>
            <div>
              <strong>Road Distance:</strong><br />
              <span style={{ color: '#6b7280' }}>{routeInfo.totalDistance.toFixed(0)}m</span>
            </div>
          </div>
          <div style={{
            padding: '12px',
            background: routeInfo.efficiency > 80 ? '#d1fae5' : routeInfo.efficiency > 60 ? '#fef3c7' : '#fee2e2',
            color: routeInfo.efficiency > 80 ? '#065f46' : routeInfo.efficiency > 60 ? '#92400e' : '#991b1b',
            borderRadius: '8px',
            fontWeight: 'bold',
            textAlign: 'center',
            fontSize: '16px'
          }}>
            🎯 Efficiency: {routeInfo.efficiency.toFixed(1)}%
          </div>
        </div>
      )}

      {/* Modern Status Bar */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '12px 20px',
        borderRadius: '25px',
        fontSize: '13px',
        zIndex: 1000,
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        border: '1px solid #e5e7eb'
      }}>
        <span style={{ marginRight: '15px' }}>
          📍 Start: {start ? `${start[0].toFixed(4)}, ${start[1].toFixed(4)}` : 'Not set'}
        </span>
        <span style={{ marginRight: '15px' }}>
          🎯 End: {end ? `${end[0].toFixed(4)}, ${end[1].toFixed(4)}` : 'Not set'}
        </span>
        <span style={{ marginRight: '15px' }}>
          👥 Crowds: {populatedAreas.length} areas
        </span>
        <span style={{ color: '#2563eb', fontWeight: 'bold' }}>
          {debugInfo}
        </span>
      </div>

      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Population areas with better styling */}
        {populatedAreas.map((area, index) => (
          <Circle
            key={`pop-${index}`}
            center={[area.lat, area.lng]}
            radius={40}
            pathOptions={{
              color: getPopulationColor(area.population),
              fillColor: getPopulationColor(area.population),
              fillOpacity: 0.7,
              weight: 3
            }}
          >
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <strong>👥 Crowd Area</strong><br />
                People: {area.population}<br />
                Weight: {populationGrid.getRoutingWeight(area.lat, area.lng).toFixed(2)}
              </div>
            </Popup>
          </Circle>
        ))}

        {/* Route path with better styling */}
        {currentRoute.length > 0 && (
          <Polyline
            positions={currentRoute}
            color="#dc2626"
            weight={5}
            opacity={0.8}
            dashArray="8,4"
          />
        )}

        {/* Start and end markers with better styling */}
        {start && (
          <Marker position={start}>
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <strong>📍 Start Point</strong>
              </div>
            </Popup>
          </Marker>
        )}
        {end && (
          <Marker position={end}>
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <strong>🎯 End Point</strong>
              </div>
            </Popup>
          </Marker>
        )}

        <MapClickHandler onSelect={handleSelect} onAddPerson={handleAddPerson} />
      </MapContainer>
    </div>
  );
}
