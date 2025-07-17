import React, { useEffect, useState, useRef } from "react";
import { fetchBuildings } from "./api";
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';


function latLngToXY(lat, lng, width, height) {
  const x = (lng + 180) * (width / 360);
  const y = (90 - lat) * (height / 180);
  return new THREE.Vector2(x - width / 2, y - height / 2);
}

function plot_buildings(buildings, scene, width, height) {
    for (let i = 0; i < buildings.length; i++) {
        let currentBuilding = buildings[i].polygon.coordinates[0];
        console.log("Current Building:", currentBuilding[0]);
        const latLng = latLngToXY(currentBuilding[0][1], currentBuilding[0][0], width, height);

        let geometry = new THREE.BoxGeometry(.3, .3, 20); // Adjust size as needed
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00});
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(latLng.x, latLng.y, 10);
        scene.add(cube);
    }

}


function App() {
  const [buildings, setBuildings] = useState([]);
  const mountRef = useRef(null);
  const sceneRef = useRef(null); // Optional: to reuse the scene

  useEffect(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const mount = mountRef.current; // Copy to local variable

    // Set up basic Three.js
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 200;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    sceneRef.current = scene;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;       // Optional, for smoother movement
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 10;
    controls.maxDistance = 500;

    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    camera.position.z = 40;


    // Clean up on unmount
    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    fetchBuildings()
      .then((data) => {
        setBuildings(data);
        if (sceneRef.current) {
          plot_buildings(data, sceneRef.current, window.innerWidth, window.innerHeight);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch:", err);
      });
  }, []);

  return (
    <div>
      <h1>Building Data</h1>
      <div ref={mountRef} style={{ width: "100vw", height: "100vh", position: "absolute", zIndex: 0 }} />
      <ul style={{ position: "relative", zIndex: 1, backgroundColor: "white", padding: 20 }}>
      </ul>
    </div>
  );
}
export default App;