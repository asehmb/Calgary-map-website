import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL; // set correct backend URL in .env file

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
        const response = await fetch(`${API_URL}/land-use?lng=${longitude}&lat=${latitude}`);
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

export const filterBuildings = async (query) => {
  try {
    const response = await axios.post(`${API_URL}/filter-buildings`, {
      query: query
    });
    return response.data;
  } catch (error) {
    console.error('Error filtering buildings:', error);
    return [];
  }
};

export const filterBuildingsMultiple = async (queries) => {
  try {
    const response = await axios.post(`${API_URL}/filter-buildings`, {
      queries: queries
    });
    return response.data;
  } catch (error) {
    console.error('Error filtering buildings with multiple queries:', error);
    return [];
  }
};

// Filter management functions
export const saveFilters = async (username, filterName, filters) => {
  try {
    const response = await axios.post(`${API_URL}/filters/save`, {
      username: username,
      filter_name: filterName,
      filters: filters
    });
    return response.data;
  } catch (error) {
    console.error('Error saving filters:', error);
    return { success: false, error: error.message };
  }
};

export const loadFilters = async (username, filterName = null) => {
  try {
    const params = { username };
    if (filterName) {
      params.filter_name = filterName;
    }
    
    const response = await axios.get(`${API_URL}/filters/load`, { params });
    return response.data;
  } catch (error) {
    console.error('Error loading filters:', error);
    return { success: false, error: error.message };
  }
};

export const deleteFilters = async (username, filterName) => {
  try {
    const response = await axios.delete(`${API_URL}/filters/delete`, {
      data: {
        username: username,
        filter_name: filterName
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting filters:', error);
    return { success: false, error: error.message };
  }
};

export const listUserFilters = async (username) => {
  try {
    const response = await axios.get(`${API_URL}/filters/list`, {
      params: { username }
    });
    return response.data;
  } catch (error) {
    console.error('Error listing filters:', error);
    return { success: false, error: error.message };
  }
};