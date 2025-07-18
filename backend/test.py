

def find_center(list_of_points):
    if not list_of_points:
        return None
    latitudes = [point[0] for point in list_of_points]
    longitudes = [point[1] for point in list_of_points]
    center_lat = sum(latitudes) / len(latitudes)
    center_lng = sum(longitudes) / len(longitudes)
    return (center_lat, center_lng)

find_center_cal = find_center([[-114.0887390547, 50.9801920852], [-114.0886205017, 50.9801924592], [-114.0886207278, 50.9802633583], [-114.0887391292, 50.9802633323]])

print("Center of some building:", find_center_cal)