import React, { useEffect, useState, useRef } from "react";
import { fetchBuildings, fetchLandUse, filterBuildings } from "./api";
import * as THREE from "three";
import { MapControls } from 'three/examples/jsm/controls/MapControls';

// center of calgary
const centerCalgary = { lat: 51.0447, lng: -114.0719 };



function latLngToXY(lat, lng, width, height) {
  const x = (lng + 180) * (width / 360);
  const y = (90 - lat) * (height / 180);
  return new THREE.Vector2(x - width / 2, y - height / 2);
}

function getPolygonCenter(points) {
    const center = new THREE.Vector2(0, 0);
    points.forEach(p => center.add(p));
    return center.divideScalar(points.length);
}

// logitutde and latitude to meters
function measure(lat1, lon1, lat2, lon2){  // generally used geo measurement function
    var R = 6378.137; // Radius of earth in KM
    var dLat = lat2 * Math.PI / 180 - lat1 * Math.PI / 180;
    var dLon = lon2 * Math.PI / 180 - lon1 * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = R * c;
    return d * 1000; // meters
}

function createShapeFromVertices(vertices, center, scale = 1) {
    const shape = new THREE.Shape();
    if (vertices.length < 3) return -1; // Need at least 3 points

    // Convert each vertex to absolute XY meters relative to centerCalgary
    const points = vertices.map(coord => {
        const lon = coord[0];
        const lat = coord[1];

        // Calculate offsets in meters
        const x = measure(center.lat, center.lng, center.lat, lon) * (lon > center.lng ? 1 : -1) * scale;
        const y = measure(center.lat, center.lng, lat, center.lng) * (lat > center.lat ? 1 : -1) * scale;

        return new THREE.Vector2(x, y);
    });

    // Start path at first point
    shape.moveTo(points[0].x, points[0].y);

    // Draw lines to remaining points
    for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, points[i].y);
    }

    shape.closePath();

    return shape;
}


function plot_buildings(buildings, scene) {
    const sceneScale = .2; 
    const center = centerCalgary;

    buildings.forEach((building, index) => {
        if (!building?.polygon?.coordinates?.[0]) return;

        const polygonCoords = building.polygon.coordinates[0];
        const shape = createShapeFromVertices(polygonCoords, center, sceneScale);

        if (shape === -1) return; // invalid shape

        // Calculate and store the building's center coordinates
        const firstCoord = building.polygon.coordinates[0][0];
        const longitude = firstCoord[0];
        const latitude = firstCoord[1];
        
        // Calculate the converted X,Y coordinates in meters
        const xMeters = measure(center.lat, center.lng, center.lat, longitude) * (longitude > center.lng ? 1 : -1) * sceneScale;
        const yMeters = measure(center.lat, center.lng, latitude, center.lng) * (latitude > center.lat ? 1 : -1) * sceneScale;

        // Store coordinates back on the building object
        building.calculatedCoords = {
            longitude: longitude,
            latitude: latitude,
            xMeters: xMeters,
            yMeters: yMeters,
            sceneScale: sceneScale
        };

        const heightInMeters = building.rooftop_elev_z - building.grd_elev_min_z || 50;
        const heightValue = heightInMeters * sceneScale;
        const land_use = building.land_use; // Land use now comes with the building data
        const landUseColor = 0xffefed; // Default color if not found

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: heightValue,
            bevelEnabled: false,
        });

        const material = new THREE.MeshBasicMaterial({ color: landUseColor });
        const mesh = new THREE.Mesh(geometry, material);

        // Store building data on the mesh for click handling
        mesh.userData = { 
            building, 
            index, 
            landUse: land_use,
            coordinates: building.calculatedCoords
        };

        // Position at origin because shape is already relative to city center
        mesh.position.set(0, 0, 0);

        scene.add(mesh);
    });
}



function App() {
  const [buildings, setBuildings] = useState([]);
  const [allBuildings, setAllBuildings] = useState([]); // Store original buildings
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [filterQuery, setFilterQuery] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  useEffect(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const mount = mountRef.current;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Orthographic camera for flat map panning and zooming
    const viewSize = 500;
    const camera = new THREE.OrthographicCamera(
      (-aspect * viewSize) / 2,
      (aspect * viewSize) / 2,
      viewSize / 2,
      -viewSize / 2,
      0.1,
      2000
    );
    camera.position.set(0, 0, 1000); // Pull camera away from flat plane
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls for pan/zoom on flat map
    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = false; 
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true; 
    controls.minZoom = 0.001;
    controls.maxZoom = 1000;
    controls.panSpeed = 0.5; // Slow pan
    controlsRef.current = controls;

    // Mouse click handler
    const onMouseClick = (event) => {
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update the picking ray with the camera and mouse position
      raycasterRef.current.setFromCamera(mouseRef.current, camera);

      // Calculate objects intersecting the picking ray
      const intersects = raycasterRef.current.intersectObjects(scene.children);

      if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        if (clickedObject.userData.building) {
          setSelectedBuilding(clickedObject.userData);
          setPopupPosition({ x: event.clientX, y: event.clientY });
        }
      } else {
        setSelectedBuilding(null);
      }
    };

    renderer.domElement.addEventListener('click', onMouseClick);

    // Optional: Add a grid helper for reference
    const gridHelper = new THREE.GridHelper(1000, 50);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(0, 0, 0);
    scene.add(gridHelper);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Clean up on unmount
    return () => {
      renderer.domElement.removeEventListener('click', onMouseClick);
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (buildings.length && sceneRef.current) {
      // Clear previous buildings
      while (sceneRef.current.children.length > 0) {
        sceneRef.current.remove(sceneRef.current.children[0]);
      }
      // Add grid helper back after clearing
      const gridHelper = new THREE.GridHelper(1000, 50);
      gridHelper.rotation.x = Math.PI / 2;
        gridHelper.position.set(0, 0, -15);

      sceneRef.current.add(gridHelper);

      // Plot buildings on flat map
      plot_buildings(buildings, sceneRef.current, window.innerWidth, window.innerHeight);
    }
  }, [buildings]);

  useEffect(() => {
    fetchBuildings()
      .then((data) => {
        setAllBuildings(data); // Store original data
        setBuildings(data);    // Display all initially
      })
      .catch((err) => console.error("Failed to fetch buildings:", err));
  }, []);

  // Filter handler
  const handleFilter = async () => {
    if (!filterQuery.trim()) {
      setBuildings(allBuildings); // Reset to all buildings if no query
      return;
    }

    setIsFiltering(true);
    try {
      const filteredData = await filterBuildings(filterQuery);
      setBuildings(filteredData);
    } catch (error) {
      console.error('Filter failed:', error);
      // Keep current buildings on error
    } finally {
      setIsFiltering(false);
    }
  };

  // Reset filter
  const handleResetFilter = () => {
    setFilterQuery('');
    setBuildings(allBuildings);
  };

  return (
    <div>
      {/* Filter Controls */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 1000,
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        minWidth: '300px'
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Filter Buildings</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="e.g., tall buildings above 1150"
            style={{
              flex: 1,
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            onKeyPress={(e) => e.key === 'Enter' && handleFilter()}
          />
          <button
            onClick={handleFilter}
            disabled={isFiltering}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isFiltering ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {isFiltering ? 'Filtering...' : 'Filter'}
          </button>
          <button
            onClick={handleResetFilter}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Reset
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          Showing {buildings.length} of {allBuildings.length} buildings
        </div>
        <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
          Examples: "tall buildings above 1150", "rooftop_elev_z {'>'}  1200", "ground level above 1049"
        </div>
      </div>

      <h1>Flat Map with Buildings</h1>
      <div
        ref={mountRef}
        style={{ width: "100vw", height: "100vh", position: "absolute", zIndex: 0 }}
      />
      
      {/* Building Info Popup */}
      {selectedBuilding && (
        <div
          style={{
            position: "absolute",
            left: popupPosition.x + 10,
            top: popupPosition.y - 10,
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid #ccc",
            borderRadius: "8px",
            padding: "15px",
            boxShadow: "0 4px 8px rgba(0,0,0,0.2)",
            maxWidth: "300px",
            zIndex: 1000,
            fontSize: "14px",
            fontFamily: "Arial, sans-serif"
          }}
        >
          <button
            onClick={() => setSelectedBuilding(null)}
            style={{
              position: "absolute",
              top: "5px",
              right: "8px",
              background: "none",
              border: "none",
              fontSize: "16px",
              cursor: "pointer",
              color: "#666"
            }}
          >
            ×
          </button>
          
          <h3 style={{ margin: "0 0 10px 0", color: "#333" }}>Building Information</h3>
          
          <div style={{ lineHeight: "1.5" }}>
            <strong>Ground Elevation:</strong> {
              selectedBuilding.building.grd_elev_min_z != null 
                ? Number(selectedBuilding.building.grd_elev_min_z).toFixed(2) + " m"
                : "N/A"
            }<br/>
            <strong>Rooftop Elevation:</strong> {
              selectedBuilding.building.rooftop_elev_z != null 
                ? Number(selectedBuilding.building.rooftop_elev_z).toFixed(2) + " m"
                : "N/A"
            }<br/>
            <strong>Height:</strong> {
              selectedBuilding.building.rooftop_elev_z != null && selectedBuilding.building.grd_elev_min_z != null
                ? Number(selectedBuilding.building.rooftop_elev_z - selectedBuilding.building.grd_elev_min_z).toFixed(2) + " m"
                : "N/A"
            }<br/>
            {selectedBuilding.coordinates && (
              <>
                <strong>Longitude:</strong> {selectedBuilding.coordinates.longitude.toFixed(6)}<br/>
                <strong>Latitude:</strong> {selectedBuilding.coordinates.latitude.toFixed(6)}<br/>
                <strong>X (meters):</strong> {selectedBuilding.coordinates.xMeters.toFixed(2)} m<br/>
                <strong>Y (meters):</strong> {selectedBuilding.coordinates.yMeters.toFixed(2)} m<br/>
              </>
            )}
            {(selectedBuilding.landUse?.lu_code || selectedBuilding.building.land_use?.lu_code) && (
              <>
                <strong>Land Use Code:</strong> {selectedBuilding.landUse?.lu_code || selectedBuilding.building.land_use?.lu_code}<br/>
                {(selectedBuilding.landUse?.description || selectedBuilding.building.land_use?.description) && (
                  <><strong>Land Use:</strong> {selectedBuilding.landUse?.description || selectedBuilding.building.land_use?.description}<br/></>
                )}
                {(selectedBuilding.landUse?.major || selectedBuilding.building.land_use?.major) && (
                  <><strong>Category:</strong> {selectedBuilding.landUse?.major || selectedBuilding.building.land_use?.major}<br/></>
                )}
                {(selectedBuilding.landUse?.generalize || selectedBuilding.building.land_use?.generalize) && (
                  <><strong>General Type:</strong> {selectedBuilding.landUse?.generalize || selectedBuilding.building.land_use?.generalize}<br/></>
                )}
                {(selectedBuilding.landUse?.label || selectedBuilding.building.land_use?.label) && (
                  <><strong>Zone Label:</strong> {selectedBuilding.landUse?.label || selectedBuilding.building.land_use?.label}<br/></>
                )}
                {(selectedBuilding.landUse?.lu_bylaw || selectedBuilding.building.land_use?.lu_bylaw) && (
                  <><strong>Bylaw:</strong> {selectedBuilding.landUse?.lu_bylaw || selectedBuilding.building.land_use?.lu_bylaw}<br/></>
                )}
              </>
            )}
            {/* Debug: Show if no land use found */}
            {!selectedBuilding.landUse?.lu_code && !selectedBuilding.building.land_use?.lu_code && (
              <><strong>Land Use:</strong> No zoning data found<br/></>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
