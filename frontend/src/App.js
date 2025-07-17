import React, { useEffect, useState } from "react";
import { fetchBuildings } from "./api";

function App() {
  const [buildings, setBuildings] = useState([]);

  useEffect(() => {
    fetchBuildings()
      .then(data => {
        console.log("Fetched buildings:", data);
        setBuildings(data);
      })
      .catch(err => {
        console.error("Failed to fetch:", err);
      });
  }, []);

  return (
    <div>
      <h1>Building Data</h1>
        <ul>
          {buildings.slice(0, 1000).map((b, i) => (
            <li key={i}>
              Polygon with coordinates {b.polygon?.coordinates[0]?.map(coord => `(${coord[0]}, ${coord[1]})`).join(", ")}
            </li>
          ))}
        </ul>
    </div>
  );
}
export default App;