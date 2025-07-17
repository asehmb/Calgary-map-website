import React, { useEffect, useState, useRef } from "react";
import { fetchBuildings } from "./api";
import * as THREE from "three";
import { MapControls } from 'three/examples/jsm/controls/MapControls';

// center of calgary
const centerCalgary = { lat: 51.0447, lng: -114.0719 };

function latLngToXY(lat, lng, width, height) {
  const x = (lng + 180) * (width / 360);
  const y = (90 - lat) * (height / 180);
  return new THREE.Vector2(x - width / 2, y - height / 2);
}

function plot_buildings(buildings, scene, width, height) {
    const spacing = 30;
    for (let i = 0; i < buildings.length; i++) {
        let currentBuilding = buildings[i].polygon.coordinates[0];
        console.log("Current Building:", currentBuilding[0]);
        let x = currentBuilding[0][0];
        let y = currentBuilding[0][1];
        
        x-= centerCalgary.lng;
        y-= centerCalgary.lat;
        
        const latLng = latLngToXY(y*spacing, x*spacing, width, height);
        console.log("LatLng to XY:", latLng);

        let geometry = new THREE.BoxGeometry(1, 1, 50); // Adjust size as needed
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00});
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(latLng.x, latLng.y, 10);
        scene.add(cube);
    }
}

function App() {
  const [buildings, setBuildings] = useState([]);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  useEffect(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const mount = mountRef.current;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Orthographic camera for flat map panning and zooming
    // View size can be adjusted (e.g., 500 units visible)
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
    controls.enableDamping = false; // You can set true for smooth feel
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true; // Important for map-style panning
    controls.minZoom = 0.5;
    controls.maxZoom = 5;
    controls.panSpeed = 0.5; // Slow pan
    controlsRef.current = controls;

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
      .then((data) => setBuildings(data))
      .catch((err) => console.error("Failed to fetch buildings:", err));
  }, []);

  return (
    <div>
      <h1>Flat Map with Buildings</h1>
      <div
        ref={mountRef}
        style={{ width: "100vw", height: "100vh", position: "absolute", zIndex: 0 }}
      />
    </div>
  );
}

export default App;
