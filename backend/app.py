from flask import Flask, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

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
            "polygon": building.get("polygon"), #coordinates in GeoJSON format

        })
    return processed

@app.route('/api/buildings')
def fetch_buildings(bbox=None, limit=1000):
    url = "https://data.calgary.ca/resource/cchr-krqg.json" #data is in meters
    params = {"$limit": limit}
    if bbox:
        pass
    res = requests.get(url, params=None)
    res.raise_for_status()
    proccessed = process_buildings(res.json())
    return jsonify(proccessed)



if __name__ == "__main__":
    buildings = fetch_buildings(limit=10)
    processed_buildings = process_buildings(buildings)
    for building in processed_buildings:
        print(building)