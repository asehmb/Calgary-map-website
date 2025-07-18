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
            "polygon": building.get("polygon"),  # coordinates in GeoJSON format
        })
    return processed


def fetch_building_data(limit=1000, bbox=None):
    url = "https://data.calgary.ca/resource/cchr-krqg.json"
    params = {"$limit": limit}
    if bbox:
        pass  # implement bounding box logic here if needed
    res = requests.get(url, params=params)
    res.raise_for_status()
    return res.json()


@app.route('/api/buildings')
def buildings_endpoint():
    raw_data = fetch_building_data(limit=1000)
    processed = process_buildings(raw_data)
    return jsonify(processed)


if __name__ == "__main__":
    raw_data = fetch_building_data(limit=10)
    processed_buildings = process_buildings(raw_data)

    for building in processed_buildings:
        print("grd_elev_min_x:", building.get("grd_elev_min_x"))
        print("grd_elev_max_x:", building.get("grd_elev_max_x"))
        print("grd_elev_min_y:", building.get("grd_elev_min_y"))
        print("grd_elev_max_y:", building.get("grd_elev_max_y"))
        print("grd_elev_min_z:", building.get("grd_elev_min_z"))
        print("grd_elev_max_z:", building.get("grd_elev_max_z"))
        print("rooftop_elev_x:", building.get("rooftop_elev_x"))
        print("rooftop_elev_y:", building.get("rooftop_elev_y"))
        print("rooftop_elev_z:", building.get("rooftop_elev_z"))
        print("polygon:", building.get("polygon"))
        print("-----")
