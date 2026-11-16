"""Read NASA's average sun / Earth visibility maps at every south-pole site.

Usage:
    pip install tifffile imagecodecs
    # download both files from https://pgda.gsfc.nasa.gov/products/69 into FOLDER:
    #   AVGVISIB_75S_120M_201608.TIF and AVGVISIB_75S_120M_201608_EARTH.TIF
    python3 tools/extract-nasa-illumination.py FOLDER sites.json

sites.json is a list of {"id", "lat", "lon"} (degrees). Prints one line per
site in the format used by js/nasamaps.js.
"""
import json, math, sys
import tifffile

R = 1737.4            # km, reference sphere
HALF = 457440.0       # m, map half-width (ModelTiepoint of the 75S 120 m product)
PIX = 120.0           # m per pixel
SCALE = 4e-5          # GDAL SCALE metadata


def pixel(lat, lon):
    rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2) * 1000
    x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
    return round((HALF - y) / PIX - 0.5), round((x + HALF) / PIX - 0.5)


def main(folder, sites_path):
    sun = tifffile.imread(f"{folder}/AVGVISIB_75S_120M_201608.TIF")
    earth = tifffile.imread(f"{folder}/AVGVISIB_75S_120M_201608_EARTH.TIF")
    for s in json.load(open(sites_path)):
        r, c = pixel(s["lat"], s["lon"])
        ws = sun[r - 1:r + 2, c - 1:c + 2] * SCALE * 100
        we = earth[r - 1:r + 2, c - 1:c + 2] * SCALE * 100
        print(f"  '{s['id']}': {{ sun: {sun[r, c] * SCALE * 100:.1f}, sunMin: {ws.min():.1f}, sunMax: {ws.max():.1f}, "
              f"earth: {earth[r, c] * SCALE * 100:.1f}, earthMin: {we.min():.1f}, earthMax: {we.max():.1f} }},")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
