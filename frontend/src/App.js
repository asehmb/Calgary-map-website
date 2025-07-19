import React, { useEffect, useState, useRef, useCallback } from "react";
import { fetchBuildings, filterBuildings, filterBuildingsMultiple, saveFilters, loadFilters, deleteFilters, listUserFilters } from "./api";
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
    const [highlightedBuildings, setHighlightedBuildings] = useState([]); // Store filtered buildings to highlight
    const [selectedBuilding, setSelectedBuilding] = useState(null);
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
    const [filters, setFilters] = useState([{ id: 0, query: '' }]); // Array of filter objects
    const [nextFilterId, setNextFilterId] = useState(1);
    const [isFiltering, setIsFiltering] = useState(false);
    const [buildingsLoaded, setBuildingsLoaded] = useState(false); // Trigger for re-render
    
    // Filter management state
    const [username, setUsername] = useState('');
    const [filterName, setFilterName] = useState('');
    const [savedFilters, setSavedFilters] = useState([]);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showLoadDialog, setShowLoadDialog] = useState(false);
    const [showUserPanel, setShowUserPanel] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const mouseRef = useRef(new THREE.Vector2());
    const buildings_dict = useRef(new Map());

    // setup three js scene   
    useEffect(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;
        const mount = mountRef.current;

        // Scene setup
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        // Orthographic camera for flat map panning and zooming
        const viewSize = 200;
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
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.margin = '0';
        renderer.domElement.style.padding = '0';
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

        // Handle window resize
        const handleResize = () => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        const newAspect = newWidth / newHeight;

        // Update camera
        camera.left = (-newAspect * viewSize) / 2;
        camera.right = (newAspect * viewSize) / 2;
        camera.top = viewSize / 2;
        camera.bottom = -viewSize / 2;
        camera.updateProjectionMatrix();

        // Update renderer
        renderer.setSize(newWidth, newHeight);
        };

        window.addEventListener('resize', handleResize);

        const gridHelper = new THREE.GridHelper(500, 50);
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
        window.removeEventListener('resize', handleResize);
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
      const gridHelper = new THREE.GridHelper(500, 50);
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
        // save buildings to dictionary
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
      let filterResults = []; // Store which buildings match which filters
      
      if (activeFilters.length === 1) {
        // Single filter - use existing API (keep backward compatibility)
        try {
          const filteredData = await filterBuildings(activeFilters[0].query);
          console.log(`Single filter "${activeFilters[0].query}" returned:`, filteredData);
          
          // Handle both old format (array) and new format (object)
          if (Array.isArray(filteredData)) {
            allFilteredResults = filteredData;
            filterResults = [{ filter_index: 0, matches: filteredData, query: activeFilters[0].query }];
          } else {
            allFilteredResults = filteredData.all_matches || [];
            filterResults = filteredData.filter_results || [];
          }
        } catch (error) {
          console.error(`Filter "${activeFilters[0].query}" failed:`, error);
        }
      } else {
        // Multiple filters - use new batch API
        try {
          const queryStrings = activeFilters.map(f => f.query);
          const filteredData = await filterBuildingsMultiple(queryStrings);
          console.log(`Multiple filters returned:`, filteredData);
          
          // Handle both old format (array) and new format (object)
          if (Array.isArray(filteredData)) {
            // Fallback: old format, treat as combined results
            allFilteredResults = filteredData;
            filterResults = [{ filter_index: 0, matches: filteredData, query: "combined" }];
          } else {
            // New format with per-filter results
            allFilteredResults = filteredData.all_matches || [];
            filterResults = filteredData.filter_results || [];
          }
        } catch (error) {
          console.error('Multiple filters failed:', error);
          // Fallback to individual filter processing
          for (let i = 0; i < activeFilters.length; i++) {
            const filter = activeFilters[i];
            try {
              const filteredData = await filterBuildings(filter.query);
              console.log(`Filter "${filter.query}" returned:`, filteredData);
              const matches = Array.isArray(filteredData) ? filteredData : (filteredData.all_matches || []);
              allFilteredResults.push(...matches);
              filterResults.push({ filter_index: i, matches: matches, query: filter.query });
            } catch (error) {
              console.error(`Filter "${filter.query}" failed:`, error);
            }
          }
          // Remove duplicates from fallback processing
          allFilteredResults = [...new Set(allFilteredResults)];
        }
      }
      
      console.log("Final filtered buildings:", allFilteredResults);
      console.log("Filter results by filter:", filterResults);
      
      // Highlight buildings with different colors per filter
      let highlightedCount = 0;
      const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff]; // Multiple colors for different filters
      
      // First, apply colors based on which filter matched each building
      for (const filterResult of filterResults) {
        const filterIdx = activeFilters.findIndex(f => f.query === filterResult.query);
        const filterColor = colors[filterIdx % colors.length];

        
        for (const buildingId of filterResult.matches) {
          const building = buildings_dict.current.get(buildingId);
          if (building) {
            // If building is already highlighted by a previous filter, keep the first filter's color
            if (!building.isHighlighted) {
              building.colour = filterColor;
              building.isHighlighted = true;
              building.filterIndex = filterIdx; // Track which filter matched it
              highlightedCount++;
              console.log(`Building ${buildingId} highlighted with color ${filterColor.toString(16)} from filter ${filterResult.filter_index}`);
            } else {
              console.log(`Building ${buildingId} already highlighted, keeping original color`);
            }
          } else {
            console.warn("Building not found in dictionary:", buildingId);
            // Try converting to string/number in case of type mismatch
            const stringId = String(buildingId);
            const numberId = Number(buildingId);
            const buildingStr = buildings_dict.current.get(stringId);
            const buildingNum = buildings_dict.current.get(numberId);
            if (buildingStr && !buildingStr.isHighlighted) {
              buildingStr.colour = filterColor;
              buildingStr.isHighlighted = true;
              buildingStr.filterIndex = filterIdx;
              highlightedCount++;
            } else if (buildingNum && !buildingNum.isHighlighted) {
              buildingNum.colour = filterColor;
              buildingNum.isHighlighted = true;
              buildingNum.filterIndex = filterIdx;
              highlightedCount++;
            }
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

  // Filter management functions
  const handleSaveFilters = async () => {
    if (!username.trim()) {
      alert('Please enter a username');
      return;
    }
    if (!filterName.trim()) {
      alert('Please enter a filter name');
      return;
    }
    
    const activeFilters = filters.filter(f => f.query.trim());
    if (activeFilters.length === 0) {
      alert('Please add at least one filter before saving');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveFilters(username, filterName, activeFilters);
      if (result.success) {
        alert(`Filters ${result.action} successfully!`);
        setFilterName('');
        setShowSaveDialog(false);
        // Refresh the saved filters list
        loadUserFiltersList();
      } else {
        alert(`Error saving filters: ${result.error}`);
      }
    } catch (error) {
      alert(`Error saving filters: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadFilters = async (filterSetName) => {
    if (!username.trim()) {
      alert('Please enter a username');
      return;
    }

    setIsLoading(true);
    try {
      const result = await loadFilters(username, filterSetName);
      if (result.success) {
        // Convert loaded filters to the correct format
        const loadedFilters = result.filters.map((filter, index) => ({
          id: index,
          query: filter.query
        }));
        
        setFilters(loadedFilters);
        setNextFilterId(loadedFilters.length);
        setShowLoadDialog(false);
        
        // Reset current highlights first
        for (const building of buildings_dict.current.values()) {
          building.colour = 0xcccccc;
          building.isHighlighted = false;
        }
        setHighlightedBuildings([]);
        
        alert('Filters loaded successfully!');
      } else {
        alert(`Error loading filters: ${result.error}`);
      }
    } catch (error) {
      alert(`Error loading filters: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserFiltersList = useCallback(async () => {
    if (!username.trim()) return;
    
    try {
      const result = await listUserFilters(username);
      if (result.success) {
        setSavedFilters(result.filter_names);
      } else {
        console.error('Error loading filter list:', result.error);
      }
    } catch (error) {
      console.error('Error loading filter list:', error.message);
    }
  }, [username]);

  const handleDeleteFilters = async (filterSetName) => {
    if (!username.trim()) return;
    
    if (!window.confirm(`Are you sure you want to delete the filter set "${filterSetName}"?`)) {
      return;
    }

    try {
      const result = await deleteFilters(username, filterSetName);
      if (result.success) {
        alert('Filter set deleted successfully!');
        loadUserFiltersList(); // Refresh the list
      } else {
        alert(`Error deleting filters: ${result.error}`);
      }
    } catch (error) {
      alert(`Error deleting filters: ${error.message}`);
    }
  };

  // Load user's saved filters when username changes
  useEffect(() => {
    if (username.trim()) {
      loadUserFiltersList();
    }
  }, [username, loadUserFiltersList]);

return (
    <div>
        {/* If user clicks on login */}
        {showUserPanel && (
        <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 1000,
                background: 'rgba(255, 255, 255, 0.9)',
                padding: '15px',
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                minWidth: '350px',
                maxHeight: '80vh',
                overflowY: 'auto',
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px'
            }}>
            <p style ={{ 
                fontSize: '16px', 
                fontWeight: 'bold', 
                textAlign: "Left",
                cursor: 'pointer',
                margin: '0 0 10px 0'
                    }}
                    >
            Login
            </p>
            <p style ={{ 
                fontSize: '16px', 
                fontWeight: 'bold', 
                textAlign: "right",
                cursor: 'pointer',
                margin: '0 0 10px 0'
                    }}
                    onClick={() => setShowUserPanel(false)}>
            X
            </p>
            </div>
                <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="enter username"
                        style={{
                                width: '90%',
                                padding: '5%',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                fontSize: '14px'
                        }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                <button
                    onClick={() => setShowSaveDialog(true)}
                    disabled={!username.trim() || filters.filter(f => f.query.trim()).length === 0}
                    style={{
                    padding: '8px 16px',
                    backgroundColor: !username.trim() || filters.filter(f => f.query.trim()).length === 0 ? '#ccc' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    width: '49.5%',
                    cursor: !username.trim() || filters.filter(f => f.query.trim()).length === 0 ? 'not-allowed' : 'pointer'
                    }}
                >
                    Save Filters
                </button>
                <button
                    onClick={() => setShowLoadDialog(true)}
                    disabled={!username.trim()}
                    style={{
                    padding: '8px 16px',
                    backgroundColor: !username.trim() ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    width: '49.5%',
                    cursor: !username.trim() ? 'not-allowed' : 'pointer'
                    }}
                >
                    Load Filters
                </button>
                </div>

        </div>
        )}
        {/* if user panel off */}
        {!showUserPanel && (
        <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 1000,
                background: 'rgba(255, 255, 255, 0.9)',
                padding: '15px',
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                maxHeight: '80vh',
                overflowY: 'auto'
        }}
        >
            <p style={{ 
                fontSize: '16px', 
                fontWeight: 'bold', 
                textAlign: "Left",
                margin: '0 0 10px 0'
            }}>
            3D map of calgary buildings
            </p>
            <button
                    style={{
                    padding: '8px 16px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    width: '100%',
                    cursor: 'pointer',

                    }}
                    onClick={() => setShowUserPanel(true)}

                >
                    Login
                </button>
        </div>
    )}
    {/* Filter Controls */}
    <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
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
                        fontSize: '13px',
                        maxWidth: '100%'
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
            Showing {buildings_dict.current.size} buildings total, {highlightedBuildings.length} highlighted
        </div>
    <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
        Examples: "height above 100m", "buildings shorter than 50m", "ground level above sea level"
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

    <div
    ref={mountRef}
    style={{ 
        width: "100vw", 
        height: "100vh", 
        position: "absolute", 
        top: 0,
        left: 0,
        margin: 0,
        padding: 0,
        zIndex: 0 
    }}
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
    
    {/* Save Filters Dialog */}
    {showSaveDialog && (
    <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2000
    }}>
        <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        minWidth: '300px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Save Filters</h3>
        <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Set Filter Name:
            </label>
            <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="e.g., Downtown High-rises"
            style={{
                width: '80%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
            }}
            onKeyPress={(e) => e.key === 'Enter' && handleSaveFilters()}
            />
        </div>
        <div style={{ marginBottom: '15px', fontSize: '12px', color: '#666' }}>
            Username: <strong>{username}</strong>
        </div>
        <div style={{ marginBottom: '15px', fontSize: '12px', color: '#666' }}>
            Active Filters: {filters.filter(f => f.query.trim()).length}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
            <button
            onClick={handleSaveFilters}
            disabled={isSaving || !filterName.trim()}
            style={{
                flex: 1,
                padding: '10px',
                backgroundColor: isSaving || !filterName.trim() ? '#ccc' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isSaving || !filterName.trim() ? 'not-allowed' : 'pointer'
            }}
            >
            {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
            onClick={() => {
                setShowSaveDialog(false);
                setFilterName('');
            }}
            style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
            }}
            >
            Cancel
            </button>
        </div>
        </div>
    </div>
    )}

    {/* Load Filters Dialog */}
    {showLoadDialog && (
    <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2000
    }}>
        <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        minWidth: '400px',
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Load Filters</h3>
        <div style={{ marginBottom: '15px', fontSize: '12px', color: '#666' }}>
            Username: <strong>{username}</strong>
        </div>
            
            {savedFilters.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                No saved filters found for this user.
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                {savedFilters.map((filterSet, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    backgroundColor: '#f8f9fa'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{filterSet.name}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        Updated: {new Date(filterSet.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button
                        onClick={() => handleLoadFilters(filterSet.name)}
                        disabled={isLoading}
                        style={{
                          padding: '5px 10px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: isLoading ? 'not-allowed' : 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteFilters(filterSet.name)}
                        style={{
                          padding: '5px 10px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowLoadDialog(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
