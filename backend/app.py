from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import os
import re
import json
from dotenv import load_dotenv
from geojson import Point
from shapely.geometry import shape, Point as ShapelyPoint
from huggingface_hub.inference_api import InferenceApi
from db import init_db, save_filters, load_filters, delete_filters, get_user_filter_names

# Load environment variables
load_dotenv()

# Initialize database
init_db()


def extract_filter_with_llm(user_query):
    """Use Hugging Face LLM to extract filter criteria from natural language"""
        
    # Try pattern matching for natural language to save on api credits
    # nlp_result = extract_filter_nlp_patterns(user_query)
    # if nlp_result:
    #     print(f"NLP pattern matching worked: {nlp_result}")
    #     return nlp_result
    

    hf_token = os.getenv('HUGGINGFACE_API_TOKEN')
    if not hf_token:
        print("Warning: No Hugging Face API token found, all parsing methods failed")
        return None

    print(f"Using LLM to parse: {user_query}")

    api_url = "https://router.huggingface.co/hf-inference/models/HuggingFaceTB/SmolLM3-3B/v1/chat/completions"

    prompt = f"""You are a helpful assistant. Convert the following natural language filter query to a JSON object.
    
Query: "{user_query}"

Available attributes:
- height (building height in meters)
- rooftop_elev_z (roof elevation above sea level)
- grd_elev_min_z (min ground elevation above sea level)
- grd_elev_max_z (max ground elevation above sea level)
- land_use (land use type / land code of the building)

- larger,bigger,above,taller: >
- smaller,shorter: <
- is: ==

Respond only with JSON like: {{"attribute": "height", "operator": ">", "value": 100}}"""

    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json"
    }

    payload = {
        "messages": [
            {
                "role": "system",
                "content": prompt
            }
        ],
        "model": "HuggingFaceTB/SmolLM3-3B"
    }

    try:
        response = requests.post(api_url, headers=headers, json=payload)
        response.raise_for_status()

        result = response.json()
        print("Raw output:", result)

        # Extract content
        content = result['choices'][0]['message']['content']

        # Use regex to extract JSON block inside triple backticks
        match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
        if match:
            json_str = match.group(1)
            try:
                parsed = json.loads(json_str)
                print(parsed)
                # {'attribute': 'height', 'operator': '>', 'value': 50}
                return parsed
            except json.JSONDecodeError as e:
                print("Invalid JSON:", e)
        else:
            print("No JSON found in the content")
    except Exception as e:
        print(f"Error calling Hugging Face API: {e}")

    return None

""" from chatgpt """
def extract_filter_nlp_patterns(user_query):
    """Extract filters using natural language pattern matching"""
    query = user_query.lower().strip()
    
    # Pattern matching for common phrases
    patterns = [
        # "tall buildings" or "height above X" or "above X meters" - use rooftop elevation as proxy for height
        (r'(?:tall|height|elevation).*?(?:above|over|greater than|>)\s*(\d+(?:\.\d+)?)', 'height', '>'),
        (r'(?:above|over)\s*(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '>'),
        # "short buildings" or "height below X"  
        (r'(?:short|low|height|elevation).*?(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)', 'height', '<'),
        (r'(?:below|under)\s*(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '<'),
        # "ground level above X"
        (r'(?:ground|base).*?(?:above|over|>)\s*(\d+(?:\.\d+)?)', 'grd_elev_min_z', '>'),
        # "ground level below X"
        (r'(?:ground|base).*?(?:below|under|<)\s*(\d+(?:\.\d+)?)', 'grd_elev_min_z', '<'),
        # "buildings taller than X"
        (r'(?:buildings?|structures?).*?(?:taller|higher).*?(?:than|>)\s*(\d+(?:\.\d+)?)', 'height', '>'),
        # "buildings shorter than X"
        (r'(?:buildings?|structures?).*?(?:shorter|lower).*?(?:than|<)\s*(\d+(?:\.\d+)?)', 'height', '<'),
        # Simple "X meters" (assume height)
        (r'(\d+(?:\.\d+)?)\s*(?:meters?|m)', 'height', '>'),
    ]
    
    print(f"Trying to match patterns for: '{query}'")
    
    for i, (pattern, attribute, operator) in enumerate(patterns):
        match = re.search(pattern, query)
        if match:
            value = match.group(1)
            result = {
                'attribute': attribute,
                'operator': operator,
                'value': value
            }
            print(f"Pattern {i} matched: {result}")
            return result
    
    print("No patterns matched")
    return None


app = Flask(__name__)

# Configure CORS - Allow all origins for Render deployment
# This is needed because Render can assign different subdomains
CORS(app, origins=["https://calgary-map-frontend.onrender.com", "localhost:3000"], supports_credentials=True)

# API Configuration from environment variables
CALGARY_LAND_USE_API = os.getenv('CALGARY_LAND_USE_API', 'https://data.calgary.ca/resource/mw9j-jik5.json')
BUILDING_URL = os.getenv('BUILDING_API_URL', 'https://data.calgary.ca/resource/cchr-krqg.json')
CALGARY_APP_TOKEN = os.getenv('CALGARY_APP_TOKEN')
CALGARY_API_SECRET = os.getenv('CALGARY_API_SECRET')

# Cache for building data
buildings_cache = {
    'raw_data': None,
    'processed_data': None,
    'cache_time': None,
    'bbox': None
}

# Cache duration in seconds (e.g., 1 hour)
CACHE_DURATION = 3600

@app.route('/')
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "message": "Calgary Map API is running",
        "endpoints": [
            "/api/buildings",
            "/api/buildings-with-land-use",
            "/api/filter-buildings",
            "/api/land-use",
            "/api/filters/save",
            "/api/filters/load",
            "/api/filters/delete",
            "/api/filters/list"
        ]
    })

@app.route('/api')
def api_info():
    """API information endpoint"""
    return jsonify({
        "message": "Calgary Map API",
        "version": "1.0",
        "endpoints": {
            "buildings": "/api/buildings",
            "buildings_with_land_use": "/api/buildings-with-land-use",
            "filter_buildings": "/api/filter-buildings",
            "land_use": "/api/land-use",
            "filters": {
                "save": "/api/filters/save",
                "load": "/api/filters/load",
                "delete": "/api/filters/delete",
                "list": "/api/filters/list"
            }
        }
    })

# Prepare parameters for authenticated requests
def get_api_params(base_params=None):
    """Get API parameters including authentication token"""
    params = base_params or {}
    return params

def center_point(polygon):
    """Calculate the center point of a polygon"""
    if not polygon or not polygon.get("coordinates"):
        return None
    
    coords = polygon["coordinates"][0]  # Assuming first ring is the outer boundary
    if not coords:
        return None
    
    x_coords = [coord[0] for coord in coords]
    y_coords = [coord[1] for coord in coords]
    
    center_x = sum(x_coords) / len(x_coords)
    center_y = sum(y_coords) / len(y_coords)    

    # Return as a tuple (longitude, latitude)
    return (center_x, center_y)

def process_buildings(buildings):
    processed = []
    building_count = 0
    for building in buildings:
        # Calculate building height
        rooftop_z = float(building.get("rooftop_elev_z") or 0)
        ground_z = float(building.get("grd_elev_min_z") or 0)
        height = rooftop_z - ground_z if rooftop_z and ground_z else 0
        longitude, latitude = center_point(building.get("polygon", {})) or (0, 0)
        
        processed.append({
            "grd_elev_min_x": building.get("grd_elev_min_x"),
            "grd_elev_max_x": building.get("grd_elev_max_x"),
            "grd_elev_min_y": building.get("grd_elev_min_y"),
            "grd_elev_max_y": building.get("grd_elev_max_y"),
            "grd_elev_min_z": building.get("grd_elev_min_z"),
            "grd_elev_max_z": building.get("grd_elev_max_z"),
            "rooftop_elev_x": building.get("rooftop_elev_x"),
            "rooftop_elev_y": building.get("rooftop_elev_y"),
            "rooftop_elev_z": building.get("rooftop_elev_z"),
            "height": str(height),  # Add calculated height field
            "land_use": building.get("land_use"),
            "polygon": building.get("polygon"),  # coordinates in GeoJSON format
            "struct_id": building.get("struct_id"),
            "id": building_count,
            "colour": 0xcccccc, # default color for buildings
            "longitude": longitude,
            "latitude": latitude,
        })
        building_count += 1
    return processed


def get_cached_processed_buildings(limit=1000, bbox=None):
    import time
    
    # Create a cache key based on bbox and limit
    cache_key = f"{limit}_{bbox}"
    current_time = time.time()
    
    # Check if we have valid cached processed data
    if (buildings_cache['processed_data'] is not None and 
        buildings_cache['cache_time'] is not None and
        buildings_cache['bbox'] == cache_key and
        current_time - buildings_cache['cache_time'] < CACHE_DURATION):
        
        print(f"Using cached processed building data ({len(buildings_cache['processed_data'])} buildings)")
        return buildings_cache['processed_data']
    
    # Fetch and process fresh data
    raw_data = fetch_building_data(limit=limit, bbox=bbox)
    processed_data = process_buildings(raw_data)
    
    # Update processed data cache
    buildings_cache['processed_data'] = processed_data
    print(f"Processed and cached {len(processed_data)} buildings")
    
    return processed_data


def fetch_building_data(limit=1000, bbox=None):
    import time
    
    # Create a cache key based on bbox and limit
    cache_key = f"{limit}_{bbox}"
    current_time = time.time()
    
    # Check if we have valid cached data
    if (buildings_cache['raw_data'] is not None and 
        buildings_cache['cache_time'] is not None and
        buildings_cache['bbox'] == cache_key and
        current_time - buildings_cache['cache_time'] < CACHE_DURATION):
        
        print(f"Using cached building data ({len(buildings_cache['raw_data'])} buildings)")
        return buildings_cache['raw_data']
    
    # Fetch fresh data
    print(f"Fetching fresh building data from API...")
    url = BUILDING_URL
    params = {"$limit": limit}
    if bbox:
        params["$where"] = f"within_box(polygon, {bbox['max_lat']}, {bbox['min_lng']}, {bbox['min_lat']}, {bbox['max_lng']})"
    
    params = get_api_params(params)
    res = requests.get(url, params=params)
    res.raise_for_status()
    raw_data = res.json()
    
    # Update cache
    buildings_cache['raw_data'] = raw_data
    buildings_cache['cache_time'] = current_time
    buildings_cache['bbox'] = cache_key
    print(f"Cached {len(raw_data)} buildings")
    
    return raw_data


@app.route('/api/buildings')
def buildings_endpoint():
    downtown_bbox = {
        "max_lat": 51.06,
        "min_lat": 51.04,
        "min_lng": -114.09,
        "max_lng": -114.05
    }

    processed = get_cached_processed_buildings(limit=1000, bbox=downtown_bbox)
    return jsonify(processed)

@app.route("/api/filter-buildings", methods=["POST"])
def filter_buildings():
    data = request.get_json()
    user_query = data.get("query", "")
    user_queries = data.get("queries", [])  # Support multiple queries
    
    # Handle both single query and multiple queries
    if user_queries:
        queries_to_process = user_queries
    elif user_query:
        queries_to_process = [user_query]
    else:
        return jsonify({"error": "No query or queries provided"}), 400

    # Get cached buildings
    downtown_bbox = {
        "max_lat": 51.06,
        "min_lat": 51.04,
        "min_lng": -114.09,
        "max_lng": -114.05
    }
    
    buildings = get_cached_processed_buildings(limit=1000, bbox=downtown_bbox)
    
    # Store results per filter for color mapping
    filter_results = []
    all_matched_ids = set()  # Use set to avoid duplicates
    
    # loop through all queries for multiple queries
    for query_index, query in enumerate(queries_to_process):
        print(f"Processing query: '{query}'")
        
        filter_criteria = extract_filter_with_llm(query)
        if not filter_criteria:
            print(f"Could not extract filter from query: '{query}'")
            continue

        attr = filter_criteria["attribute"]
        op = filter_criteria["operator"]
        value = str(filter_criteria["value"])

        def matches(b):
            try:
                raw_val = b.get(attr)
                if raw_val is None:
                    return False

                if isinstance(raw_val, str):
                    raw_val = raw_val.lower().replace("m", "").strip()
                    if not raw_val.replace(".", "", 1).isdigit():
                        return False

                v = float(raw_val)
                result = eval(f"v {op} {value}")
                if result:
                    building_id = b.get("id", "unknown")
                    print(f"Query '{query}': Building {building_id} matches ({attr}={v} {op} {value})")
                return result
            except Exception as e:
                print(f"Error matching building for query '{query}': {e}")
                return False

        # Find matches for this query
        query_matches = [b.get("id") for b in buildings if matches(b)]
        filter_results.append({
            "query": query,
            "filter_index": query_index,
            "matches": query_matches
        })
        all_matched_ids.update(query_matches)
        print(f"Query '{query}' found {len(query_matches)} matches")
    
    final_matches = list(all_matched_ids)
    print(f"Total unique matches across all queries: {len(final_matches)}")
    print(f"Matched building IDs: {final_matches}")
    
    # Return both individual filter results and combined results
    response = {
        "all_matches": final_matches,
        "filter_results": filter_results
    }
    
    return jsonify(response)

@app.route('/api/land-use', methods=['GET'])
def get_land_use():
    try:
        # Get parameters from request
        longitude = float(request.args.get('lng'))
        latitude = float(request.args.get('lat'))

        # Socrata requires POINT(LONG LAT)
        point_wkt = f"POINT({longitude} {latitude})"

        print(f"Querying land use API for: {point_wkt}")
        
        # Socrata spatial query
        query_params = {
            "$where": f"intersects(the_geom, '{point_wkt}')",
            "$limit": 1  # usually only one polygon contains the point
        }

        response = requests.get(CALGARY_LAND_USE_API, params=query_params)
        response.raise_for_status()
        data = response.json()

        if data:
            return jsonify({
                'status': 'success',
                'data': data[0]  # return the first match
            })
        else:
            return jsonify({
                'status': 'success',
                'data': None,
                'message': 'No land use data found for this location'
            })

    except Exception as e:
        print(f"Error in land use lookup: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/buildings-with-land-use')
def buildings_with_land_use():
    """Get buildings with their land use codes in one request"""
    downtown_bbox = {
        "max_lat": 51.06,
        "min_lat": 51.04,
        "min_lng": -114.09,
        "max_lng": -114.05
    }

    # Get cached buildings (without land use initially)
    buildings = get_cached_processed_buildings(limit=1000, bbox=downtown_bbox)
    
    print(f"Found {len(buildings)} buildings")
    
    try:
        print(f"Fetching land use data from {CALGARY_LAND_USE_API}")
        response = requests.get(CALGARY_LAND_USE_API, params={"$limit": 2000})
        response.raise_for_status()
        land_use_data = response.json()

        # Preprocess: build a list of shapely multipolygons
        land_use_polygons = []
        for record in land_use_data:
            if record and 'multipolygon' in record and record.get('lu_code'):
                try:
                    polygon = shape(record['multipolygon'])  # Convert GeoJSON to Shapely
                    land_use_polygons.append({
                        'geometry': polygon,
                        'data': record
                    })
                except Exception as shape_error:
                    print(f"Error parsing polygon: {shape_error}")
                    continue

        matched_count = 0
        for building in buildings:
            building['land_use'] = None

            if building.get('polygon') and building['polygon'].get('coordinates'):
                try:
                    building_geom = shape(building['polygon'])
                    centroid = building_geom.centroid

                    # Find the first land use polygon containing the centroid
                    for lu in land_use_polygons:
                        if lu['geometry'].intersects(building_geom):
                            building['land_use'] = {
                                'lu_code': lu['data'].get('lu_code'),
                                'description': lu['data'].get('description'),
                                'label': lu['data'].get('label'),
                                'major': lu['data'].get('major'),
                                'generalize': lu['data'].get('generalize'),
                            }
                            matched_count += 1
                            break


                except Exception as e:
                    print(f"Error processing building: {e}")
                    continue

        print(f"Matched {matched_count} buildings with land use data")
        return jsonify(buildings)

    except Exception as e:
        print(f"Error fetching land use data: {e}")
        for building in buildings:
            building['land_use'] = None
        return jsonify(buildings)

@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """Clear the building cache - useful for development"""
    global buildings_cache
    buildings_cache = {
        'raw_data': None,
        'processed_data': None,
        'cache_time': None,
        'bbox': None
    }
    return jsonify({'message': 'Cache cleared successfully'})

@app.route('/api/cache/status', methods=['GET'])
def cache_status():
    """Get cache status information"""
    import time
    current_time = time.time()
    
    status = {
        'has_raw_data': buildings_cache['raw_data'] is not None,
        'has_processed_data': buildings_cache['processed_data'] is not None,
        'cache_time': buildings_cache['cache_time'],
        'bbox': buildings_cache['bbox'],
        'cache_age_seconds': current_time - buildings_cache['cache_time'] if buildings_cache['cache_time'] else None,
        'cache_duration_seconds': CACHE_DURATION,
        'is_cache_valid': (buildings_cache['cache_time'] is not None and 
                          current_time - buildings_cache['cache_time'] < CACHE_DURATION)
    }
    
    if buildings_cache['raw_data']:
        status['raw_data_count'] = len(buildings_cache['raw_data'])
    if buildings_cache['processed_data']:
        status['processed_data_count'] = len(buildings_cache['processed_data'])
    
    return jsonify(status)

# Filter management endpoints
@app.route('/api/filters/save', methods=['POST'])
def save_user_filters():
    """Save filters for a user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        filter_name = data.get('filter_name', '').strip()
        filters_data = data.get('filters', [])
        
        if not username:
            return jsonify({"success": False, "error": "Username is required"}), 400
        if not filter_name:
            return jsonify({"success": False, "error": "Filter name is required"}), 400
        if not filters_data:
            return jsonify({"success": False, "error": "Filters data is required"}), 400
        
        result = save_filters(username, filter_name, filters_data)
        
        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/filters/load', methods=['GET'])
def load_user_filters():
    """Load filters for a user"""
    try:
        username = request.args.get('username', '').strip()
        filter_name = request.args.get('filter_name', '').strip()
        
        if not username:
            return jsonify({"success": False, "error": "Username is required"}), 400
        
        if filter_name:
            # Load specific filter set
            result = load_filters(username, filter_name)
        else:
            # Load all filter sets for user
            result = load_filters(username)
        
        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 404 if "not found" in result.get("error", "").lower() else 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/filters/delete', methods=['DELETE'])
def delete_user_filters():
    """Delete a filter set for a user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        filter_name = data.get('filter_name', '').strip()
        
        if not username:
            return jsonify({"success": False, "error": "Username is required"}), 400
        if not filter_name:
            return jsonify({"success": False, "error": "Filter name is required"}), 400
        
        result = delete_filters(username, filter_name)
        
        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 404 if "not found" in result.get("error", "").lower() else 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/filters/list', methods=['GET'])
def list_user_filters():
    """Get all filter names for a user"""
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({"success": False, "error": "Username is required"}), 400
        
        result = get_user_filter_names(username)
        
        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Load environment variables
    debug_mode = os.getenv('FLASK_DEBUG', 'True').lower() in ['true', '1', 'yes']
    port = int(os.getenv('PORT', os.getenv('FLASK_PORT', 5050)))  # Render uses PORT env var
    host = os.getenv('HOST', '0.0.0.0')  # Bind to all interfaces for Render
    
    print(f"Starting Flask app...")
    print(f"Debug mode: {debug_mode}")
    print(f"Host: {host}")
    print(f"Port: {port}")
    print(f"API Token configured: {'Yes' if CALGARY_APP_TOKEN else 'No'}")
    
    app.run(debug=debug_mode, host=host, port=port)
