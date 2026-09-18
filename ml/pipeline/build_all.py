"""Run the full provisional pilot build in order. Usage: ml/.venv/bin/python ml/pipeline/build_all.py"""
import build_grid_terrain, build_landcover, build_osm, build_inventory, build_rainfall, build_manifest

if __name__ == "__main__":
    for step in (build_grid_terrain, build_landcover, build_osm, build_inventory, build_rainfall, build_manifest):
        print(f"== {step.__name__}", flush=True)
        step.main()
