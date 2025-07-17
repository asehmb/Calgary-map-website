import axios from 'axios';

const API_URL = "http://localhost:5050/api"; // Flask running on port 5050

export const fetchBuildings = async () => {
  const res = await axios.get(`${API_URL}/buildings`);
  return res.data;
};