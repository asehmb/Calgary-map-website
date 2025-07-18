import React, { useEffect, useState, useRef } from "react";
import { fetchBuildings, fetchLandUse, filterBuildings, filterBuildingsMultiple } from "./api";
import * as THREE from "three";
import { MapControls } from 'three/examples/jsm/controls/MapControls';

// center of calgary
const centerCalgary = { lat: 51.0447, lng: -114.0719 };


// function latLngToXY(lat, lng, width, height) {
//   const x = (lng + 180) * (width / 360);
//   const y = (90 - lat) * (height / 180);
//   return new THREE.Vector2(x - width / 2, y - height / 2);
// }

// function getPolygonCenter(points) {
//     const center = new THREE.Vector2(0, 0);
//     points.forEach(p => center.add(p));
//     return center.divideScalar(points.length);
// }

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


function plot_buildings(buildings, scene, highlight_color = 0xff4444) {
    const sceneScale = .2; 
    const center = centerCalgary;
    let highlightedRenderedCount = 0;
    let totalRenderedCount = 0;

    for (const building of buildings.values()) {
        if (!building?.polygon?.coordinates?.[0]) continue;

        const polygonCoords = building.polygon.coordinates[0];
        const shape = createShapeFromVertices(polygonCoords, center, sceneScale);

        if (shape === -1) continue; // invalid shape

        totalRenderedCount++;

        // Calculate and store the building's center coordinates
        const firstCoord = building.polygon.coordinates[0][0];
        const longitude = firstCoord[0];
        const latitude = firstCoord[1];
        
        // Calculate the converted X,Y coordinates in meters
        const xMeters = measure(center.lat, center.lng, center.lat, longitude) * (longitude > center.lng ? 1 : -1) * sceneScale;
        const yMeters = measure(center.lat, center.lng, latitude, center.lng) * (latitude > center.lat ? 1 : -1) * sceneScale;

        const heightInMeters = building.height;
        const heightValue = heightInMeters * sceneScale;
        
        // Store coordinates back on the building object
        building.calculatedCoords = {
            longitude: longitude,
            latitude: latitude,
            xMeters: xMeters,
            yMeters: yMeters,
        };
        
        const land_use = building.land_use; // Land use now comes with the building data
        
        // Color and opacity logic for highlighting
        let buildingColor; // Default gray set in flask
        let opacity = 1.0; // Default full opacity
        
        if (building.isHighlighted) {
            buildingColor = highlight_color; // Red for highlighted
            opacity = 1.0;
            highlightedRenderedCount++;
            console.log("Rendering highlighted building:", building.id);
        } else {
            buildingColor = building.colour;
            opacity = building.isHighlighted ? 1.0 : 0.3; // Low opacity for non-highlighted when filtering
        }

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: heightValue,
            bevelEnabled: false,
        });

        const material = new THREE.MeshBasicMaterial({ 
            color: buildingColor,
            transparent: (opacity < 1.0), // Only set transparent if opacity is less than 1
            opacity: opacity
        });
        const mesh = new THREE.Mesh(geometry, material);

        // Store building data on the mesh for click handling
        mesh.userData = { 
            building, 
            id: building.id, 
            landUse: land_use,
            coordinates: building.calculatedCoords,
            isHighlighted: building.isHighlighted
        };

        // Position at origin because shape is already relative to city center
        mesh.position.set(0, 0, 0);

        scene.add(mesh);
    }
    
    console.log(`Rendered ${highlightedRenderedCount} highlighted buildings out of ${totalRenderedCount} total buildings`);
}



function App() {
  const [buildings, setBuildings] = useState([]);
  const [highlightedBuildings, setHighlightedBuildings] = useState([]); // Store filtered buildings to highlight
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [filters, setFilters] = useState([{ id: 0, query: '' }]); // Array of filter objects
  const [nextFilterId, setNextFilterId] = useState(1);
  const [isFiltering, setIsFiltering] = useState(false);
  const [buildingsLoaded, setBuildingsLoaded] = useState(false); // Trigger for re-render
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const buildings_dict = useRef(new Map()); // This will hold the building data

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

  // main loop
  useEffect(() => {
    if (buildingsLoaded && sceneRef.current) {
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
      plot_buildings(buildings_dict.current, sceneRef.current);
    }
  }, [buildingsLoaded, highlightedBuildings]);

  useEffect(() => {
    fetchBuildings()
      .then((data) => {
        setBuildings(data);    // Display all initially
        // save buildings to global variable for later use
        buildings_dict.current.clear(); // Clear existing data
        for (let i = 0; i < data.length; i++) {
          buildings_dict.current.set(data[i].id, data[i]);
        }
        setBuildingsLoaded(true); // Trigger re-render
        console.log("Loaded buildings into dictionary:", buildings_dict.current.size);
        console.log("Sample building IDs:", Array.from(buildings_dict.current.keys()));
      })
      .catch((err) => console.error("Failed to fetch buildings:", err));
  }, []);

  // Add a new filter
  const addFilter = () => {
    setFilters(prev => [...prev, { id: nextFilterId, query: '' }]);
    setNextFilterId(prev => prev + 1);
  };

  // Remove a filter
  const removeFilter = (filterId) => {
    setFilters(prev => prev.filter(f => f.id !== filterId));
  };

  // Update a filter query
  const updateFilter = (filterId, query) => {
    setFilters(prev => prev.map(f => f.id === filterId ? { ...f, query } : f));
  };

  // Filter handler for multiple filters
  const handleFilter = async () => {
    const activeFilters = filters.filter(f => f.query.trim());
    
    if (activeFilters.length === 0) {
      setHighlightedBuildings([]); // Reset highlights if no active filters
      // Reset all building colors
      for (const building of buildings_dict.current.values()) {
        building.colour = 0xcccccc; // Reset to default gray
        building.isHighlighted = false;
      }
      return;
    }

    setIsFiltering(true);
    try {
      // Reset all building colors first
      for (const building of buildings_dict.current.values()) {
        building.colour = 0xcccccc; // Default gray for non-highlighted
        building.isHighlighted = false;
      }
      
      // Process all filters - use batch processing if multiple filters
      let allFilteredResults = [];
      
      if (activeFilters.length === 1) {
        // Single filter - use existing API
        try {
          const filteredData = await filterBuildings(activeFilters[0].query);
          console.log(`Single filter "${activeFilters[0].query}" returned:`, filteredData);
          allFilteredResults = filteredData;
        } catch (error) {
          console.error(`Filter "${activeFilters[0].query}" failed:`, error);
        }
      } else {
        // Multiple filters - use new batch API
        try {
          const queryStrings = activeFilters.map(f => f.query);
          const filteredData = await filterBuildingsMultiple(queryStrings);
          console.log(`Multiple filters returned:`, filteredData);
          allFilteredResults = filteredData;
        } catch (error) {
          console.error('Multiple filters failed:', error);
          // Fallback to individual filter processing
          for (const filter of activeFilters) {
            try {
              const filteredData = await filterBuildings(filter.query);
              console.log(`Filter "${filter.query}" returned:`, filteredData);
              allFilteredResults.push(...filteredData);
            } catch (error) {
              console.error(`Filter "${filter.query}" failed:`, error);
            }
          }
          // Remove duplicates from fallback processing
          allFilteredResults = [...new Set(allFilteredResults)];
        }
      }
      
      console.log("Final filtered buildings:", allFilteredResults);
      
      // Highlight the filtered buildings
      let highlightedCount = 0;
      const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff]; // Multiple colors for different filters
      
      for (let i = 0; i < allFilteredResults.length; i++) {
        const buildingId = allFilteredResults[i];
        console.log("Looking for building ID:", buildingId, "Type:", typeof buildingId);
        const building = buildings_dict.current.get(buildingId);
        if (building) {
          building.colour = colors[highlightedCount % colors.length]; // Cycle through colors
          building.isHighlighted = true;
          highlightedCount++;
        } else {
          console.warn("Building not found in dictionary:", buildingId);
          // Try converting to string/number in case of type mismatch
          const stringId = String(buildingId);
          const numberId = Number(buildingId);
          const buildingStr = buildings_dict.current.get(stringId);
          const buildingNum = buildings_dict.current.get(numberId);
          if (buildingStr) {
            console.log("Found building with string ID:", stringId);
            buildingStr.colour = colors[highlightedCount % colors.length];
            buildingStr.isHighlighted = true;
            highlightedCount++;
          } else if (buildingNum) {
            console.log("Found building with number ID:", numberId);
            buildingNum.colour = colors[highlightedCount % colors.length];
            buildingNum.isHighlighted = true;
            highlightedCount++;
          }
        }
      }
      
      console.log(`Successfully highlighted ${highlightedCount} out of ${allFilteredResults.length} buildings`);
      
      // Trigger re-render by updating state
      setHighlightedBuildings(allFilteredResults);
    } catch (error) {
      console.error('Filter failed:', error);
      // Keep current highlights on error
    } finally {
      setIsFiltering(false);
    }
  };

  // Reset all filters
  const handleResetFilter = () => {
    setFilters([{ id: 0, query: '' }]);
    setNextFilterId(1);
    setHighlightedBuildings([]);
    // Reset all building colors
    for (const building of buildings_dict.current.values()) {
      building.colour = 0xcccccc; // Reset to default gray
      building.isHighlighted = false;
    }
    // Force re-render by updating buildingsLoaded state
    setBuildingsLoaded(prev => !prev);
    setTimeout(() => setBuildingsLoaded(prev => !prev), 50);
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
        minWidth: '350px',
        maxHeight: '80vh',
        overflowY: 'auto'
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Multiple Filters</h3>
        
        {/* Filter Inputs */}
        {filters.map((filter, index) => (
          <div key={filter.id} style={{ 
            display: 'flex', 
            gap: '8px', 
            alignItems: 'center', 
            marginBottom: '8px',
            padding: '8px',
            background: 'rgba(240, 240, 240, 0.5)',
            borderRadius: '4px'
          }}>
            <span style={{ 
              minWidth: '20px', 
              fontSize: '12px', 
              color: '#666',
              fontWeight: 'bold'
            }}>
              {index + 1}:
            </span>
            <input
              type="text"
              value={filter.query}
              onChange={(e) => updateFilter(filter.id, e.target.value)}
              placeholder="e.g., tall buildings above 50"
              style={{
                flex: 1,
                padding: '6px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '13px'
              }}
              onKeyPress={(e) => e.key === 'Enter' && handleFilter()}
            />
            {filters.length > 1 && (
              <button
                onClick={() => removeFilter(filter.id)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        
        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
          <button
            onClick={addFilter}
            style={{
              padding: '6px 12px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            + Add Filter
          </button>
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
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            {isFiltering ? 'Filtering...' : 'Apply Filters'}
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
            Reset All
          </button>
        </div>
        
        <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          Showing {buildings.length} buildings total, {highlightedBuildings.length} highlighted
        </div>
        <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
          Examples: "height above 100", "tall buildings above 50", "ground level above 1049"
        </div>
        
        {/* Active Filters Display */}
        {filters.filter(f => f.query.trim()).length > 0 && (
          <div style={{ marginTop: '10px', fontSize: '11px' }}>
            <strong>Active Filters:</strong>
            {filters.filter(f => f.query.trim()).map((filter, index) => (
              <div key={filter.id} style={{ 
                color: '#555', 
                marginLeft: '10px',
                padding: '2px 6px',
                background: `rgba(${index === 0 ? '255,68,68' : index === 1 ? '68,255,68' : index === 2 ? '68,68,255' : '255,255,68'}, 0.2)`,
                borderRadius: '3px',
                margin: '2px 0'
              }}>
                {index + 1}. {filter.query}
              </div>
            ))}
          </div>
        )}
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
          
          <h3 style={{ margin: "0 0 10px 0", color: "#333" }}>
            Building Information
            {selectedBuilding.isHighlighted && (
              <span style={{ 
                marginLeft: "10px", 
                padding: "2px 6px", 
                background: "#ff4444", 
                color: "white", 
                borderRadius: "3px", 
                fontSize: "10px" 
              }}>
                HIGHLIGHTED
              </span>
            )}
          </h3>
          
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
