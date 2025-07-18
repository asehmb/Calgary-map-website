import axios from 'axios';

const API_URL = "http://localhost:5050/api"; // Flask running on port 5050

export const fetchBuildings = async () => {
  const res = await axios.get(`${API_URL}/buildings-with-land-use`);
//   const dummyBuildings = [
//     {
//         polygon: {
//         coordinates: [
//             [
//             [-73.985130, 40.758896],
//             [-73.984, 40.758],
//             [-73.984, 40.759],
//             [-73.985, 40.759],
//             [-73.985130, 40.758896]
//             ]
//         ]
//         }
//     }
//     ];
//     return dummyBuildings; // Return dummy data for testing
    return res.data;
};

export const fetchLandUse = async (longitude, latitude) => {
  try {
        const response = await fetch(`http://localhost:5050/api/land-use?lng=${longitude}&lat=${latitude}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            return data.data;  // Returns the land use record or null
        } else {
            console.error('API Error:', data.message);
            return null;
        }
    } catch (error) {
        console.error('Network Error:', error);
        return null;
    }

}