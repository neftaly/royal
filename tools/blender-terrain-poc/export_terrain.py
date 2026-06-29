#!/usr/bin/env python3
"""Generate a tiny Blender terrain handoff bundle for Royal."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import random
import shlex
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import bpy
    from mathutils import Vector
except ModuleNotFoundError:
    print(
        "Blender Python module 'bpy' is not available. Run this through Blender, "
        "for example: node tools/blender-terrain-poc/run.mjs",
        file=sys.stderr,
    )
    raise SystemExit(2)


TOOL_REVISION = "blender-terrain-poc@0.1.0"
TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = TOOL_DIR / "config" / "low.json"
DEFAULT_OUT = TOOL_DIR / "out" / "low"


def main() -> None:
    args = parse_args()
    config = read_json(args.config)
    apply_overrides(config, args)

    out_dir = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    for child in ["meshes", "textures", "previews", "reports"]:
        (out_dir / child).mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    clear_scene(config)
    materials = create_materials()
    terrain = create_terrain(config, materials)
    asset_records, asset_objects = create_assets(config, materials)
    add_lighting_and_camera(config)

    scene_objects = [terrain, *asset_objects]
    scene_ms = elapsed_ms(started)

    texture_started = time.perf_counter()
    texture_artifacts = write_texture_previews(config, out_dir)
    texture_ms = elapsed_ms(texture_started)

    preview_path = out_dir / "previews" / "tile-preview.png"
    preview_started = time.perf_counter()
    render_preview(config, preview_path)
    preview_ms = elapsed_ms(preview_started)

    glb_path = out_dir / "meshes" / "terrain-tile.glb"
    export_started = time.perf_counter()
    glb_result = export_glb(glb_path)
    export_ms = elapsed_ms(export_started)
    if glb_result["status"] != "written":
        raise RuntimeError(f"GLB export failed: {glb_result}")

    report = {
        "status": "ok",
        "toolRevision": TOOL_REVISION,
        "recipe": config["recipe"],
        "blenderVersion": bpy.app.version_string,
        "pythonVersion": platform.python_version(),
        "timingsMs": {
            "scene": round_ms(scene_ms),
            "textures": round_ms(texture_ms),
            "preview": round_ms(preview_ms),
            "glbExport": round_ms(export_ms),
        },
        "objects": [obj.name for obj in scene_objects],
    }
    report_path = out_dir / "reports" / "build-report.json"
    write_json(report_path, report)

    manifest = build_manifest(
        config=config,
        out_dir=out_dir,
        mesh_path=glb_path,
        texture_artifacts=texture_artifacts,
        preview_path=preview_path,
        report_path=report_path,
        asset_records=asset_records,
        bounds=object_bounds_y_up(scene_objects),
        terrain_bounds=object_bounds_y_up([terrain]),
        glb_result=glb_result,
        args=args,
        timings=report["timingsMs"],
    )
    manifest_path = out_dir / "manifest.json"
    write_json(manifest_path, manifest)

    print(
        json.dumps(
            {
                "status": "ok",
                "manifest": manifest_path.as_posix(),
                "glb": glb_path.as_posix(),
                "preview": preview_path.as_posix(),
                "artifactCount": artifact_count(manifest),
            },
            indent=2,
            sort_keys=True,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--quality", choices=["preview", "draft", "high"], default=None)
    parser.add_argument("--segments", type=int, default=None)
    parser.add_argument("--texture-size", type=int, default=None)
    parser.add_argument("--preview-size", type=int, default=None)
    argv = sys.argv
    script_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    return parser.parse_args(script_args)


def apply_overrides(config: dict[str, object], args: argparse.Namespace) -> None:
    recipe = config.setdefault("recipe", {})
    if args.quality is not None:
        recipe["quality"] = args.quality
    if args.segments is not None:
        recipe["segments"] = args.segments
    if args.texture_size is not None:
        recipe["textureSize"] = args.texture_size
    if args.preview_size is not None:
        recipe["previewSize"] = args.preview_size


def clear_scene(config: dict[str, object]) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    preview_size = int(config["recipe"]["previewSize"])
    bpy.context.scene.render.resolution_x = preview_size
    bpy.context.scene.render.resolution_y = preview_size
    if hasattr(bpy.context.scene, "eevee"):
        eevee = bpy.context.scene.eevee
        for samples_attr in ["taa_render_samples", "taa_samples"]:
            if hasattr(eevee, samples_attr):
                try:
                    setattr(eevee, samples_attr, 8)
                except Exception:
                    pass
    try:
        bpy.context.scene.view_settings.view_transform = "Standard"
        bpy.context.scene.view_settings.look = "Medium High Contrast"
    except TypeError:
        pass


def create_materials() -> dict[str, object]:
    return {
        "grass": make_material("poc_grass", (0.24, 0.43, 0.25, 1), 0.85),
        "stone": make_material("poc_stone", (0.44, 0.45, 0.42, 1), 0.9),
        "sand": make_material("poc_sand", (0.62, 0.56, 0.39, 1), 0.78),
        "bark": make_material("poc_bark", (0.32, 0.2, 0.12, 1), 0.88),
        "leaf": make_material("poc_leaf", (0.16, 0.34, 0.18, 1), 0.76),
        "marker": make_material("poc_marker", (0.92, 0.55, 0.18, 1), 0.5),
    }


def make_material(name: str, color: tuple[float, float, float, float], roughness: float):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return material


def create_terrain(config: dict[str, object], materials: dict[str, object]):
    tile = config["tile"]
    recipe = config["recipe"]
    segments = int(recipe["segments"])
    size = float(tile["sizeMeters"])
    seed = config["world"]["seed"]
    vertices = []
    faces = []

    for z_index in range(segments + 1):
        web_z = -size / 2 + (z_index / segments) * size
        for x_index in range(segments + 1):
            web_x = -size / 2 + (x_index / segments) * size
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

    mesh = bpy.data.meshes.new("poc_terrain_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    mesh.materials.append(materials["grass"])
    mesh.materials.append(materials["stone"])
    mesh.materials.append(materials["sand"])
    for polygon in mesh.polygons:
        avg_height = sum(vertices[index][2] for index in polygon.vertices) / len(polygon.vertices)
        polygon.material_index = terrain_material(avg_height)

    obj = bpy.data.objects.new("poc_terrain_tile", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def terrain_material(height: float) -> int:
    if height > 4.4:
        return 1
    if height < -0.9:
        return 2
    return 0


def create_assets(config: dict[str, object], materials: dict[str, object]):
    seed = config["world"]["seed"]
    rng = random.Random(stable_int(seed))
    records = []
    objects = []
    for plan in config.get("assets", []):
        web_x, web_z = plan["position"]
        ground_y = height_at(seed, web_x, web_z)
        scale = float(plan.get("scale", 1))
        if plan["kind"] == "tree":
            created = add_tree(plan["id"], web_x, ground_y, web_z, scale, materials)
        elif plan["kind"] == "rocks":
            created = add_rocks(plan["id"], web_x, ground_y, web_z, scale, materials, rng, seed)
        elif plan["kind"] == "marker":
            created = add_marker(plan["id"], web_x, ground_y, web_z, scale, materials)
        else:
            raise ValueError(f"unsupported asset kind: {plan['kind']}")

        objects.extend(created)
        records.append(
            {
                "id": plan["id"],
                "kind": plan["kind"],
                "position": round_vector((web_x, ground_y, web_z)),
                "bounds": object_bounds_y_up(created),
                "objectNames": [obj.name for obj in created],
                "sourceStage": "blender-primitive-poc",
                "inputsHash": sha256_text(json.dumps(plan, sort_keys=True)),
            }
        )
    return records, objects


def add_tree(asset_id: str, x: float, y: float, z: float, scale: float, materials: dict[str, object]):
    trunk_height = 2.8 * scale
    canopy_height = 3.2 * scale
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=8,
        radius=0.24 * scale,
        depth=trunk_height,
        location=web_to_blender((x, y + trunk_height / 2, z)),
    )
    trunk = bpy.context.object
    trunk.name = f"{asset_id}:trunk"
    trunk.data.materials.append(materials["bark"])

    bpy.ops.mesh.primitive_cone_add(
        vertices=12,
        radius1=1.25 * scale,
        radius2=0.12 * scale,
        depth=canopy_height,
        location=web_to_blender((x, y + trunk_height + canopy_height / 2 - 0.2 * scale, z)),
    )
    canopy = bpy.context.object
    canopy.name = f"{asset_id}:canopy"
    canopy.data.materials.append(materials["leaf"])
    return [trunk, canopy]


def add_rocks(
    asset_id: str,
    x: float,
    y: float,
    z: float,
    scale: float,
    materials: dict[str, object],
    rng: random.Random,
    seed: str,
):
    created = []
    for index, offset in enumerate([(-0.9, 0.15), (0.2, -0.2), (0.85, 0.25)]):
        px = x + offset[0] * scale
        pz = z + offset[1] * scale
        radius = (0.45 + rng.random() * 0.25) * scale
        py = height_at(seed, px, pz) + radius * 0.55
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=radius,
            location=web_to_blender((px, py, pz)),
        )
        rock = bpy.context.object
        rock.name = f"{asset_id}:rock-{index + 1}"
        rock.scale = (1.0, 0.78 + rng.random() * 0.18, 0.58 + rng.random() * 0.16)
        rock.rotation_euler[2] = rng.random() * math.tau
        rock.data.materials.append(materials["stone"])
        created.append(rock)
    return created


def add_marker(asset_id: str, x: float, y: float, z: float, scale: float, materials: dict[str, object]):
    size = 1.2 * scale
    bpy.ops.mesh.primitive_cube_add(size=size, location=web_to_blender((x, y + size / 2, z)))
    marker = bpy.context.object
    marker.name = asset_id
    marker.rotation_euler[2] = math.radians(18)
    marker.data.materials.append(materials["marker"])
    return [marker]


def add_lighting_and_camera(config: dict[str, object]) -> None:
    size = float(config["tile"]["sizeMeters"])
    bpy.ops.object.light_add(type="SUN", location=(0, 0, size))
    sun = bpy.context.object
    sun.name = "poc_sun"
    sun.data.energy = 2.1
    sun.rotation_euler = (math.radians(50), 0, math.radians(34))

    bpy.ops.object.camera_add(
        location=(size * 0.7, -size * 0.95, size * 0.62),
        rotation=(math.radians(62), 0, math.radians(39)),
    )
    bpy.context.scene.camera = bpy.context.object


def write_texture_previews(config: dict[str, object], out_dir: Path) -> list[Path]:
    size = int(config["recipe"]["textureSize"])
    texture_dir = out_dir / "textures"
    files = [
        (texture_dir / "albedo-preview.png", "albedo"),
        (texture_dir / "normal-preview.png", "normal"),
        (texture_dir / "material-mask-preview.png", "mask"),
    ]
    seed = config["world"]["seed"]
    for path, kind in files:
        write_texture_image(path, size, kind, seed)
    return [path for path, _kind in files]


def write_texture_image(path: Path, size: int, kind: str, seed: str) -> None:
    image = bpy.data.images.new(name=path.stem, width=size, height=size, alpha=True)
    pixels = []
    for y in range(size):
        z = -24 + (y / max(size - 1, 1)) * 48
        for x in range(size):
            world_x = -24 + (x / max(size - 1, 1)) * 48
            height = height_at(seed, world_x, z)
            if kind == "normal":
                color = (0.5, 0.5, 1.0, 1.0)
            elif kind == "mask":
                material_id = terrain_material(height)
                color = ((material_id + 1) / 3, material_id / 3, 0.25, 1.0)
            elif height > 4.4:
                color = (0.44, 0.45, 0.42, 1.0)
            elif height < -0.9:
                color = (0.62, 0.56, 0.39, 1.0)
            else:
                color = (0.24, 0.43, 0.25, 1.0)
            pixels.extend(color)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def render_preview(config: dict[str, object], preview_path: Path) -> None:
    preview_size = int(config["recipe"]["previewSize"])
    scene = bpy.context.scene
    scene.render.resolution_x = preview_size
    scene.render.resolution_y = preview_size
    scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)


def export_glb(path: Path) -> dict[str, object]:
    diagnostics = []
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as exc:
        diagnostics.append(f"gltf-addon-enable: {exc}")
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            export_animations=False,
        )
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB")
    except Exception as exc:
        return {"status": "failed", "diagnostics": [*diagnostics, str(exc)]}
    return {"status": "written" if path.exists() else "missing-after-export", "diagnostics": diagnostics}


def build_manifest(
    *,
    config: dict[str, object],
    out_dir: Path,
    mesh_path: Path,
    texture_artifacts: list[Path],
    preview_path: Path,
    report_path: Path,
    asset_records: list[dict[str, object]],
    bounds: dict[str, object],
    terrain_bounds: dict[str, object],
    glb_result: dict[str, object],
    args: argparse.Namespace,
    timings: dict[str, object],
) -> dict[str, object]:
    revision = config["recipe"]["id"]
    artifacts = {
        "mesh": artifact_record(out_dir, mesh_path, "mesh.terrain.glb", "model/gltf-binary", "glb2"),
        "preview": artifact_record(out_dir, preview_path, "preview.tile", "image/png", "png-rgba8"),
        "report": artifact_record(out_dir, report_path, "report.build", "application/json", "json"),
    }
    texture_records = []
    for path in texture_artifacts:
        slot = path.stem.replace("-preview", "")
        texture_records.append(
            {
                **artifact_record(out_dir, path, f"texture.{slot}", "image/png", "png-rgba8"),
                "slot": "material-mask" if slot == "material-mask" else slot,
                "dimensions": [int(config["recipe"]["textureSize"]), int(config["recipe"]["textureSize"])],
                "colorSpace": "srgb" if slot == "albedo" else "linear",
            }
        )

    return {
        "manifestVersion": int(config.get("manifestVersion", 1)),
        "world": config["world"],
        "tile": {
            **config["tile"],
            "bounds": terrain_bounds,
            "quality": config["recipe"]["quality"],
            "revision": revision,
        },
        "lod": {
            "identityPolicy": "stable-world-tile-page",
            "levels": [
                {
                    "id": "lod0-preview",
                    "level": 0,
                    "screenSpaceError": float(config["recipe"]["screenSpaceError"]),
                    "mesh": artifacts["mesh"]["id"],
                    "textures": [record["id"] for record in texture_records],
                    "preview": artifacts["preview"]["id"],
                    "quality": config["recipe"]["quality"],
                }
            ],
        },
        "meshes": [
            {
                **artifacts["mesh"],
                "bounds": terrain_bounds,
                "vertexCount": (int(config["recipe"]["segments"]) + 1) ** 2,
                "indexCount": int(config["recipe"]["segments"]) * int(config["recipe"]["segments"]) * 6,
                "sourceStage": "blender-heightfield-poc",
            }
        ],
        "materialTextures": texture_records,
        "previews": [
            {
                **artifacts["preview"],
                "role": "thumbnail",
                "dimensions": [int(config["recipe"]["previewSize"]), int(config["recipe"]["previewSize"])],
            }
        ],
        "reports": [artifacts["report"]],
        "assets": asset_records,
        "bounds": bounds,
        "provenance": {
            "recipe": config["recipe"],
            "generator": {
                "name": "tools/blender-terrain-poc/export_terrain.py",
                "version": TOOL_REVISION,
                "command": command_line(args),
            },
            "source": {
                "kind": "procedural-blender-primitives",
                "config": relative_to_tool(args.config),
                "infinigen": "not used in low-quality POC; normalize Infinigen scenes through this manifest later",
            },
            "inputsHash": sha256_text(json.dumps(config, sort_keys=True)),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "machine": {
                "blenderVersion": bpy.app.version_string,
                "pythonVersion": platform.python_version(),
            },
            "export": {"glb": glb_result},
            "timingsMs": timings,
        },
    }


def artifact_record(root: Path, path: Path, artifact_id: str, media_type: str, format_name: str) -> dict[str, object]:
    return {
        "id": artifact_id,
        "uri": path.relative_to(root).as_posix(),
        "mediaType": media_type,
        "format": format_name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def height_at(seed: str, x: float, z: float) -> float:
    offset = (stable_int(seed) % 8192) / 8192
    hill = math.sin(x * 0.17 + offset * math.tau) * 1.45
    roll = math.cos(z * 0.13 - offset * math.pi) * 1.15
    ridge = math.sin((x + z) * 0.08 + offset) * 0.9
    peak = 3.7 * math.exp(-((x - 7.0) ** 2 + (z + 6.0) ** 2) / 120.0)
    basin = -1.8 * math.exp(-((x + 12.0) ** 2 + (z - 8.0) ** 2) / 180.0)
    return hill + roll + ridge + peak + basin


def web_to_blender(position: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = position
    return (x, -z, y)


def blender_to_web(position: Vector) -> tuple[float, float, float]:
    return (position.x, position.z, -position.y)


def object_bounds_y_up(objects: list[object]) -> dict[str, object]:
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


def command_line(args: argparse.Namespace) -> str:
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not script_args:
        script_args = ["--config", relative_to_tool(args.config), "--out", args.out.as_posix()]
    return " ".join(
        shlex.quote(part)
        for part in [
            "blender",
            "--background",
            "--factory-startup",
            "--python",
            relative_to_tool(Path(__file__)),
            "--",
            *script_args,
        ]
    )


def relative_to_tool(path: Path) -> str:
    resolved = path.expanduser().resolve()
    try:
        return resolved.relative_to(TOOL_DIR.parent.parent).as_posix()
    except ValueError:
        return resolved.as_posix()


def artifact_count(manifest: dict[str, object]) -> int:
    return sum(len(manifest.get(key, [])) for key in ["meshes", "materialTextures", "previews", "reports"])


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.expanduser().read_text(encoding="utf-8"))


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


def round_vector(values) -> list[float]:
    return [round(float(value), 4) for value in values]


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000


def round_ms(value: float) -> float:
    return round(value, 3)


if __name__ == "__main__":
    main()
