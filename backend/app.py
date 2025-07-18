from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv
from geojson import Point
from shapely.geometry import shape, Point as ShapelyPoint

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app, origins=[os.getenv('CORS_ORIGINS', 'http://localhost:3000')])

# API Configuration from environment variables
CALGARY_LAND_USE_API = os.getenv('CALGARY_LAND_USE_API', 'https://data.calgary.ca/resource/mw9j-jik5.json')
BUILDING_URL = os.getenv('BUILDING_API_URL', 'https://data.calgary.ca/resource/cchr-krqg.json')
CALGARY_APP_TOKEN = os.getenv('CALGARY_APP_TOKEN')
CALGARY_API_SECRET = os.getenv('CALGARY_API_SECRET')

# Prepare parameters for authenticated requests
def get_api_params(base_params=None):
    """Get API parameters including authentication token"""
    params = base_params or {}
    # Note: Calgary Open Data APIs work without authentication for these endpoints
    # Adding app token actually causes 403 errors, so we'll skip it
    return params

def process_buildings(buildings):
    processed = []
    for building in buildings:
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
            "polygon": building.get("polygon"),  # coordinates in GeoJSON format
        })
    return processed


def fetch_building_data(limit=1000, bbox=None):
    url = BUILDING_URL
    params = {"$limit": limit}
    if bbox:
        params["$where"] = f"within_box(polygon, {bbox['max_lat']}, {bbox['min_lng']}, {bbox['min_lat']}, {bbox['max_lng']})"
    
    params = get_api_params(params)
    res = requests.get(url, params=params)
    res.raise_for_status()
    return res.json()


@app.route('/api/buildings')
def buildings_endpoint():
    downtown_bbox = {
        "max_lat": 51.06,
        "min_lat": 51.04,
        "min_lng": -114.09,
        "max_lng": -114.05
    }

    raw_data = fetch_building_data(limit=1000, bbox=downtown_bbox)
    processed = process_buildings(raw_data)
    return jsonify(processed)

@app.route('/api/land-use', methods=['GET'])
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

    # Fetch buildings
    raw_building_data = fetch_building_data(limit=1000, bbox=downtown_bbox)
    buildings = process_buildings(raw_building_data)
    
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

if __name__ == "__main__":
    # Load environment variables for development
    debug_mode = os.getenv('FLASK_DEBUG', 'True').lower() in ['true', '1', 'yes']
    port = int(os.getenv('FLASK_PORT', 5000))
    
    print(f"Starting Flask app...")
    print(f"Debug mode: {debug_mode}")
    print(f"Port: {port}")
    print(f"API Token configured: {'Yes' if CALGARY_APP_TOKEN else 'No'}")
    
    app.run(debug=debug_mode, port=port)
