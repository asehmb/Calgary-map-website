import axios from 'axios';

const API_URL = "http://localhost:5050/api"; // Flask running on port 5050

export const fetchBuildings = async () => {
  const res = await axios.get(`${API_URL}/buildings`);
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