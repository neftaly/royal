#!/usr/bin/env python3
"""Generate a cheap Blender static terrain tile for Royal research."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


PIPELINE_REVISION = "cheap-blender-pipeline@0.1.0"
RECIPE = "royal-cheap-terrain-assets@0.1.0"
DEFAULT_SEED = "royal:cheap-blender-static-tile:001"
PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = PIPELINE_DIR / "out"


def main() -> None:
    args = parse_args()
    out_dir = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    total_started = time.perf_counter()
    scene_started = time.perf_counter()
    clear_scene()
    materials = create_materials()
    terrain = create_terrain(materials, args.seed)
    asset_records, asset_objects = create_assets(materials, args.seed)
    add_scene_lighting()
    generated_objects = [terrain, *asset_objects]
    scene_ms = elapsed_ms(scene_started)

    glb_path = out_dir / "royal-cheap-blender-tile.glb"
    export_started = time.perf_counter()
    glb_result = export_glb(glb_path)
    export_ms = elapsed_ms(export_started)

    timings: dict[str, object] = {
        "revision": args.revision,
        "recipe": RECIPE,
        "seed": args.seed,
        "stages": {
            "sceneMs": round_ms(scene_ms),
            "exportMs": round_ms(export_ms),
        },
        "artifacts": [],
    }

    artifacts: list[dict[str, object]] = []
    if glb_result["status"] == "written":
        artifacts.append(artifact_record(glb_path, "model/gltf-binary", "glTF 2.0 GLB"))
    else:
        artifacts.append(
            {
                "path": manifest_path_for(glb_path),
                "format": "glTF 2.0 GLB",
                "status": glb_result["status"],
                "diagnostics": glb_result["diagnostics"],
            }
        )

    timings_path = out_dir / "timings.json"
    manifest_path = out_dir / "manifest.json"
    timings["stages"]["totalBeforeManifestMs"] = round_ms(elapsed_ms(total_started))

    manifest_started = time.perf_counter()
    write_json(
        manifest_path,
        build_manifest(
            args=args,
            artifacts=artifacts,
            asset_records=asset_records,
            generated_objects=generated_objects,
            glb_result=glb_result,
            timings=None,
        ),
    )
    manifest_ms = elapsed_ms(manifest_started)

    timings["stages"]["manifestMs"] = round_ms(manifest_ms)
    timings["stages"]["totalMs"] = round_ms(elapsed_ms(total_started))
    timings["artifacts"] = [
        file_timing_record(path)
        for path in [glb_path]
        if path.exists()
    ]
    write_json(timings_path, timings)

    manifest = build_manifest(
        args=args,
        artifacts=[*artifacts, artifact_record(timings_path, "application/json", "pipeline timings")],
        asset_records=asset_records,
        generated_objects=generated_objects,
        glb_result=glb_result,
        timings=timings,
    )
    write_json(manifest_path, manifest)

    print(
        json.dumps(
            {
                "status": "ok",
                "manifest": manifest_path_for(manifest_path),
                "glb": manifest_path_for(glb_path) if glb_result["status"] == "written" else None,
                "glbStatus": glb_result["status"],
                "timingsMs": timings["stages"],
                "fileSizes": {
                    manifest_path_for(path): path.stat().st_size
                    for path in [glb_path, manifest_path, timings_path]
                    if path.exists()
                },
            },
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--revision", default=PIPELINE_REVISION)

    argv = sys.argv
    script_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    return parser.parse_args(script_args)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "grass": make_material("royal_grass_soil", (0.33, 0.48, 0.27, 1.0), roughness=0.82),
        "stone": make_material("royal_exposed_stone", (0.42, 0.43, 0.39, 1.0), roughness=0.88),
        "sand": make_material("royal_wet_sand", (0.58, 0.53, 0.41, 1.0), roughness=0.78),
        "bark": make_material("royal_bark", (0.36, 0.22, 0.14, 1.0), roughness=0.9),
        "leaf": make_material("royal_leaf", (0.18, 0.39, 0.24, 1.0), roughness=0.72),
        "marker": make_material("royal_marker_cube", (0.84, 0.58, 0.2, 1.0), roughness=0.55),
    }


def make_material(name: str, base_color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
    return material


def create_terrain(materials: dict[str, bpy.types.Material], seed: str) -> bpy.types.Object:
    segments = 28
    tile_size = 64.0
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    for z_index in range(segments + 1):
        web_z = -tile_size / 2 + (z_index / segments) * tile_size
        for x_index in range(segments + 1):
            web_x = -tile_size / 2 + (x_index / segments) * tile_size
            web_y = height_at(seed, web_x, web_z)
            vertices.append(web_to_blender((web_x, web_y, web_z)))

    stride = segments + 1
    for z_index in range(segments):
        for x_index in range(segments):
            a = z_index * stride + x_index
            b = a + 1
            c = a + stride
            d = c + 1
            faces.append((a, c, b))
            faces.append((b, c, d))

    mesh = bpy.data.meshes.new("royal_cheap_terrain_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new("royal_cheap_terrain", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.materials.append(materials["grass"])
    mesh.materials.append(materials["stone"])
    mesh.materials.append(materials["sand"])
    for polygon in mesh.polygons:
        avg_height = sum(vertices[index][2] for index in polygon.vertices) / len(polygon.vertices)
        polygon.material_index = terrain_material_index(avg_height)

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def terrain_material_index(height: float) -> int:
    if height > 5.8:
        return 1
    if height < -1.8:
        return 2
    return 0


def create_assets(materials: dict[str, bpy.types.Material], seed: str) -> tuple[list[dict[str, object]], list[bpy.types.Object]]:
    rng = random.Random(stable_int(seed))
    plans = [
        {"id": "asset:tree:west", "kind": "tree", "position": (-18.0, -9.0), "scale": 1.15},
        {"id": "asset:tree:ridge", "kind": "tree", "position": (13.5, 10.0), "scale": 0.95},
        {"id": "asset:rocks:south", "kind": "rock-cluster", "position": (-4.0, 19.0), "scale": 1.0},
        {"id": "asset:cube:survey-marker", "kind": "cube", "position": (20.0, -18.0), "scale": 1.0},
    ]
    records: list[dict[str, object]] = []
    objects: list[bpy.types.Object] = []

    for plan in plans:
        web_x, web_z = plan["position"]
        ground_y = height_at(seed, web_x, web_z)
        scale = plan["scale"]
        if plan["kind"] == "tree":
            created = add_tree(plan["id"], web_x, ground_y, web_z, scale, materials)
        elif plan["kind"] == "rock-cluster":
            created = add_rock_cluster(plan["id"], web_x, ground_y, web_z, scale, materials, rng, seed)
        else:
            created = add_cube(plan["id"], web_x, ground_y, web_z, scale, materials)

        objects.extend(created)
        records.append(
            {
                "assetId": plan["id"],
                "kind": plan["kind"],
                "stage": "cheap-static-fixture",
                "position": round_vector((web_x, ground_y, web_z)),
                "objectNames": [obj.name for obj in created],
                "bounds": object_bounds_y_up(created),
                "provenance": {
                    "seed": seed,
                    "recipe": RECIPE,
                    "source": "procedural-primitives",
                    "inputsHash": sha256_text(json.dumps(plan, sort_keys=True)),
                },
            }
        )

    return records, objects


def add_tree(
    asset_id: str,
    web_x: float,
    ground_y: float,
    web_z: float,
    scale: float,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    trunk_height = 3.0 * scale
    canopy_height = 3.7 * scale
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=10,
        radius=0.32 * scale,
        depth=trunk_height,
        location=web_to_blender((web_x, ground_y + trunk_height / 2, web_z)),
    )
    trunk = bpy.context.object
    trunk.name = f"{asset_id}:trunk"
    trunk.data.materials.append(materials["bark"])

    bpy.ops.mesh.primitive_cone_add(
        vertices=14,
        radius1=1.55 * scale,
        radius2=0.15 * scale,
        depth=canopy_height,
        location=web_to_blender((web_x, ground_y + trunk_height + canopy_height / 2 - 0.25 * scale, web_z)),
    )
    canopy = bpy.context.object
    canopy.name = f"{asset_id}:canopy"
    canopy.data.materials.append(materials["leaf"])
    return [trunk, canopy]


def add_rock_cluster(
    asset_id: str,
    web_x: float,
    ground_y: float,
    web_z: float,
    scale: float,
    materials: dict[str, bpy.types.Material],
    rng: random.Random,
    seed: str,
) -> list[bpy.types.Object]:
    objects = []
    for index, offset in enumerate([(-1.2, -0.3), (0.2, 0.25), (1.0, -0.15)]):
        radius = (0.6 + rng.random() * 0.35) * scale
        px = web_x + offset[0] * scale
        pz = web_z + offset[1] * scale
        py = height_at(seed, px, pz) + radius * 0.45
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=radius,
            location=web_to_blender((px, py, pz)),
        )
        rock = bpy.context.object
        rock.name = f"{asset_id}:rock-{index + 1}"
        rock.scale = (1.0, 0.82 + rng.random() * 0.16, 0.55 + rng.random() * 0.22)
        rock.rotation_euler[2] = rng.random() * math.tau
        rock.data.materials.append(materials["stone"])
        objects.append(rock)
    return objects


def add_cube(
    asset_id: str,
    web_x: float,
    ground_y: float,
    web_z: float,
    scale: float,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    side = 1.4 * scale
    bpy.ops.mesh.primitive_cube_add(size=side, location=web_to_blender((web_x, ground_y + side / 2, web_z)))
    cube = bpy.context.object
    cube.name = asset_id
    cube.rotation_euler[2] = math.radians(20)
    cube.data.materials.append(materials["marker"])
    return [cube]


def add_scene_lighting() -> None:
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 30))
    sun = bpy.context.object
    sun.name = "royal_sun_preview"
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(50), math.radians(0), math.radians(35))

    bpy.ops.object.camera_add(location=(42, -62, 32), rotation=(math.radians(62), 0, math.radians(36)))
    bpy.context.scene.camera = bpy.context.object


def export_glb(glb_path: Path) -> dict[str, object]:
    diagnostics: list[str] = []
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:  # Blender builds can have this enabled already.
        diagnostics.append(f"gltf-addon-enable: {exc}")

    export_options = {
        "filepath": str(glb_path),
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": True,
        "export_animations": False,
    }
    try:
        bpy.ops.export_scene.gltf(**export_options)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB")
    except Exception as exc:
        return {"status": "failed", "diagnostics": [*diagnostics, str(exc)]}

    if glb_path.exists():
        return {"status": "written", "diagnostics": diagnostics}
    return {"status": "missing-after-export", "diagnostics": diagnostics}


def build_manifest(
    *,
    args: argparse.Namespace,
    artifacts: list[dict[str, object]],
    asset_records: list[dict[str, object]],
    generated_objects: list[bpy.types.Object],
    glb_result: dict[str, object],
    timings: dict[str, object] | None,
) -> dict[str, object]:
    manifest = {
        "schemaVersion": 1,
        "worldId": "royal-cheap-blender-world",
        "tileId": "tile:cheap-blender:lod0:x0:z0",
        "revision": args.revision,
        "stage": {
            "id": "cheap-blender-static-tile",
            "status": "prototype",
            "recipe": RECIPE,
            "provenance": {
                "generator": "research/blender-pipeline/generate_scene.py",
                "seed": args.seed,
                "blenderVersion": bpy.app.version_string,
                "pythonVersion": platform.python_version(),
                "sourceKind": "local-procedural-blender",
                "infinigenDependency": "none",
                "inputsHash": sha256_text(json.dumps({"seed": args.seed, "recipe": RECIPE}, sort_keys=True)),
            },
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "coordinateSystem": {
            "asset": {
                "name": "Royal/glTF web",
                "handedness": "right-handed",
                "up": "+Y",
                "forward": "-Z",
                "units": "meters",
            },
            "sourceBlender": {
                "handedness": "right-handed",
                "up": "+Z",
                "forward": "-Y",
                "units": "meters",
            },
            "sourceToAsset": {
                "x": "blender.x",
                "y": "blender.z",
                "z": "-blender.y",
            },
            "exporter": {
                "format": "glTF 2.0",
                "exportYUp": True,
            },
        },
        "bounds": object_bounds_y_up(generated_objects),
        "terrain": {
            "kind": "heightfield-mesh",
            "tileSizeMeters": 64,
            "segmentsPerEdge": 28,
            "bounds": object_bounds_y_up([generated_objects[0]]),
            "heightRecipe": "deterministic sin/cos hills with low ridge term",
        },
        "assets": asset_records,
        "artifacts": artifacts,
        "export": {
            "glb": glb_result,
        },
    }
    if timings is not None:
        manifest["timingsMs"] = timings["stages"]
    return manifest


def height_at(seed: str, x: float, z: float) -> float:
    seed_offset = (stable_int(seed) % 4096) / 4096
    hill = math.sin((x * 0.145) + seed_offset) * 2.1
    roll = math.cos((z * 0.11) - seed_offset * 2.0) * 1.7
    ridge = math.sin((x + z) * 0.055 + seed_offset * 4.0) * 1.25
    basin = -2.2 * math.exp(-((x + 18.0) ** 2 + (z - 14.0) ** 2) / 420.0)
    peak = 4.4 * math.exp(-((x - 9.0) ** 2 + (z + 7.0) ** 2) / 260.0)
    return hill + roll + ridge + basin + peak


def web_to_blender(position: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = position
    return (x, -z, y)


def blender_to_web(position: Vector) -> tuple[float, float, float]:
    return (position.x, position.z, -position.y)


def object_bounds_y_up(objects: list[bpy.types.Object]) -> dict[str, object]:
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            points.append(blender_to_web(obj.matrix_world @ Vector(corner)))

    if not points:
        return {"min": [0, 0, 0], "max": [0, 0, 0], "center": [0, 0, 0], "size": [0, 0, 0]}

    mins = [min(point[index] for point in points) for index in range(3)]
    maxs = [max(point[index] for point in points) for index in range(3)]
    center = [(mins[index] + maxs[index]) / 2 for index in range(3)]
    size = [maxs[index] - mins[index] for index in range(3)]
    return {
        "min": round_vector(mins),
        "max": round_vector(maxs),
        "center": round_vector(center),
        "size": round_vector(size),
    }


def artifact_record(path: Path, media_type: str, format_name: str) -> dict[str, object]:
    return {
        "path": manifest_path_for(path),
        "mediaType": media_type,
        "format": format_name,
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": sha256_file(path) if path.exists() else None,
        "status": "written" if path.exists() else "missing",
    }


def file_timing_record(path: Path) -> dict[str, object]:
    return {
        "path": manifest_path_for(path),
        "bytes": path.stat().st_size if path.exists() else 0,
    }


def manifest_path_for(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(PIPELINE_DIR).as_posix()
    except ValueError:
        return resolved.as_posix()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def stable_int(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:16], 16)


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000


def round_ms(value: float) -> float:
    return round(value, 3)


def round_vector(values) -> list[float]:
    return [round(float(value), 4) for value in values]


if __name__ == "__main__":
    main()
