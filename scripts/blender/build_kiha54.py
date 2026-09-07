"""
キハ54形500番台 — the railcar that worked 緑駅 on the 釧網本線.

Run headless:

    blender --background --python scripts/blender/build_kiha54.py

------------------------------------------------------------------------
WHERE THESE NUMBERS COME FROM
------------------------------------------------------------------------
Prototype figures and body description are taken from the published
specification of 国鉄キハ54形気動車, 北海道仕様車 (500番台):

    全長 21,300 mm / 全幅 2,920 mm / 全高 3,620 mm (501-) / 自重 38.7 t
    ステンレス製軽量車体、車体裾は絞りのない直線形状
    側面窓上下にビード加工
    客用扉は車体両端に片側2扉、850 mm 幅の片開き引戸
    両運転台式、低運転台
    正面形状は平妻貫通式、運転台窓回りを黒色とした大窓風の意匠
    運転台窓上に種別・行先表示器
    前面と側面の接合部は白色の FRP 部材を額縁状に配する
    客室窓は小型の一段上昇式、車内側に FRP 枠の内窓を備えた二重窓
    冷房装置は装備せず、屋上には押し込み式通風器を配置
    水タンクは屋上に設置
    運転台下にはスカートが装備される
    塗装: 車体には赤16号を主体として下部にクリーム10号と灰茶8号の細線を
          配したテープを貼付する

The line itself is single track, unelectrified, 1,067 mm gauge, with a
summer line speed of 80 km/h; 緑 sits at 100.9 km and the ruling 25‰ grade
of the whole line is on the 緑 - 川湯温泉 section.

Figures NOT in the source, marked `# inferred` below, are standard JNR
practice for a 21.3 m car and are recorded as inference rather than fact.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# =====================================================================
# Prototype dimensions (sourced)
# =====================================================================
CAR_LENGTH_M = 21.30
CAR_WIDTH_M = 2.92
CAR_HEIGHT_M = 3.62          # rail top to roof

# =====================================================================
# Standard JNR practice for a 21.3 m car — inference, not from the source
# =====================================================================
BOGIE_CENTRES_M = 14.40      # inferred
BOGIE_WHEELBASE_M = 2.10     # inferred
WHEEL_DIAMETER_M = 0.86      # inferred
UNDERFRAME_BOTTOM_M = 0.95   # inferred
FLOOR_HEIGHT_M = 1.25        # inferred
ROOF_SHOULDER_M = 3.20       # inferred, from the 3.62 m overall height

DOOR_WIDTH_M = 0.85          # sourced (850 mm 片開き引戸)
DOOR_HEIGHT_M = 1.85         # inferred
DOOR_CENTRE_FROM_END_M = 2.75  # inferred: doors sit at the car ends, inboard of the cabs

WINDOW_COUNT = 8             # inferred from photographs of the saloon side
WINDOW_WIDTH_M = 0.72        # inferred
WINDOW_HEIGHT_M = 0.84       # inferred
WINDOW_SILL_M = 2.12         # inferred

CAB_WINDOW_HEIGHT_M = 0.86   # inferred
CAB_LENGTH_M = 2.10          # inferred

SKIRT_DEPTH_M = 0.45         # sourced that a skirt exists; size inferred

# =====================================================================
# Livery. 赤16号 main band with thin クリーム10号 and 灰茶8号 lines beneath,
# on a stainless body. The band heights are inferred from photographs; the
# colours are the named JNR shades.
# =====================================================================
STRIPE_BROWN_BOTTOM = 1.88
STRIPE_BROWN_TOP = 1.94
STRIPE_CREAM_TOP = 2.00
STRIPE_RED_TOP = 2.42

MATERIALS = {
    #  key            name                    sRGB hex   roughness  metalness
    "stainless": ("Body_Stainless", "#b9bdc1", 0.38, 0.55),
    "red": ("Stripe_Aka16", "#c8352f", 0.55, 0.05),
    "cream": ("Stripe_Cream10", "#e5d9b8", 0.60, 0.00),
    "brown": ("Stripe_Haicha8", "#6b5a4c", 0.65, 0.00),
    "roof": ("Roof_Grey", "#8b8f92", 0.80, 0.10),
    "front": ("Cab_Front", "#d8dade", 0.45, 0.20),
    "glass": ("Glass", "#2c3a44", 0.10, 0.30),
    "black": ("Cab_Surround", "#17191c", 0.45, 0.05),
    "door": ("Door_Stainless", "#a9adb2", 0.40, 0.50),
    "underframe": ("Underframe", "#37393c", 0.85, 0.10),
    "wheel": ("Wheel_Steel", "#4a4d51", 0.55, 0.60),
    "white": ("FRP_White", "#e9ecef", 0.55, 0.00),
}

OUTPUT_RELATIVE_PATH = os.path.join("public", "assets", "models", "kiha54.glb")

HALF_LENGTH = CAR_LENGTH_M / 2.0
HALF_WIDTH = CAR_WIDTH_M / 2.0
EMBED = 0.01
TOL = 1e-6


# =====================================================================
def srgb_to_linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_string, alpha=1.0):
    raw = hex_string.lstrip("#")
    r, g, b = (srgb_to_linear(int(raw[i:i + 2], 16) / 255.0) for i in (0, 2, 4))
    return (r, g, b, alpha)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"


def make_material(key):
    name, hex_colour, roughness, metalness = MATERIALS[key]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_to_linear(hex_colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metalness
    return material


def make_solid(name, profile, faces, axis, start, end, keys, classify, bisect_z=None):
    mesh = bmesh.new()
    verts = []
    for u, v in profile:
        if axis == "X":
            co = Vector((start, u, v))
        elif axis == "Y":
            co = Vector((u, start, v))
        else:
            co = Vector((u, v, start))
        verts.append(mesh.verts.new(co))
    mesh.verts.ensure_lookup_table()
    built = [mesh.faces.new([verts[i] for i in idx]) for idx in faces]
    mesh.normal_update()
    ret = bmesh.ops.extrude_face_region(mesh, geom=built)
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    delta = {"X": Vector((end - start, 0, 0)), "Y": Vector((0, end - start, 0)), "Z": Vector((0, 0, end - start))}[axis]
    bmesh.ops.translate(mesh, verts=moved, vec=delta)

    for z in (bisect_z or []):
        bmesh.ops.bisect_plane(
            mesh, geom=mesh.verts[:] + mesh.edges[:] + mesh.faces[:],
            plane_co=Vector((0, 0, z)), plane_no=Vector((0, 0, 1)),
            clear_inner=False, clear_outer=False,
        )
    mesh.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces[:])

    data = bpy.data.meshes.new(name)
    mesh.to_mesh(data)
    mesh.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)

    ordered = []
    for k in keys:
        if k not in ordered:
            ordered.append(k)
    for k in ordered:
        obj.data.materials.append(make_material(k))
    for poly in obj.data.polygons:
        poly.material_index = ordered.index(classify(poly.center, poly.normal))
    obj.data.update()
    return obj


def make_box(name, x0, x1, y0, y1, z0, z1, key):
    return make_solid(name, [(y0, z0), (y1, z0), (y1, z1), (y0, z1)], [(0, 1, 2, 3)],
                      "X", x0, x1, [key], lambda c, n: key)


# =====================================================================
def build_body():
    """The carbody: straight sides with no tumblehome, a cambered roof, and
    the livery bands carried as material bands rather than decals."""
    profile = [
        (-HALF_WIDTH, UNDERFRAME_BOTTOM_M),
        (HALF_WIDTH, UNDERFRAME_BOTTOM_M),
        (HALF_WIDTH, ROOF_SHOULDER_M),
        (1.10, CAR_HEIGHT_M - 0.07),
        (0.55, CAR_HEIGHT_M),
        (-0.55, CAR_HEIGHT_M),
        (-1.10, CAR_HEIGHT_M - 0.07),
        (-HALF_WIDTH, ROOF_SHOULDER_M),
    ]

    def classify(centre, normal):
        if abs(normal.x) > 0.9:
            return "front"                      # the two cab ends
        if centre.z > ROOF_SHOULDER_M - 0.01:
            return "roof"
        if centre.z < STRIPE_BROWN_BOTTOM:
            return "stainless"
        if centre.z < STRIPE_BROWN_TOP:
            return "brown"
        if centre.z < STRIPE_CREAM_TOP:
            return "cream"
        if centre.z < STRIPE_RED_TOP:
            return "red"
        return "stainless"

    return make_solid(
        "Kiha54_Body", profile, [tuple(range(len(profile)))], "X",
        -HALF_LENGTH, HALF_LENGTH,
        ["stainless", "red", "cream", "brown", "roof", "front"], classify,
        bisect_z=[STRIPE_BROWN_BOTTOM, STRIPE_BROWN_TOP, STRIPE_CREAM_TOP, STRIPE_RED_TOP],
    )


def build_side_details():
    """Doors and saloon windows, as panels set just proud of the side sheet."""
    parts = []
    y_out = HALF_WIDTH + 0.012

    # two single-leaf doors per side, at the car ends
    door_x = HALF_LENGTH - DOOR_CENTRE_FROM_END_M
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = sx * door_x
            parts.append(make_box(
                f"Kiha54_Door_{'F' if sx > 0 else 'R'}{'L' if sy > 0 else 'R'}",
                cx - DOOR_WIDTH_M / 2, cx + DOOR_WIDTH_M / 2,
                sy * (HALF_WIDTH - 0.02), sy * y_out,
                FLOOR_HEIGHT_M, FLOOR_HEIGHT_M + DOOR_HEIGHT_M, "door"))
            # door window
            parts.append(make_box(
                f"Kiha54_DoorGlass_{'F' if sx > 0 else 'R'}{'L' if sy > 0 else 'R'}",
                cx - 0.28, cx + 0.28,
                sy * (HALF_WIDTH + 0.006), sy * (y_out + 0.006),
                FLOOR_HEIGHT_M + 0.90, FLOOR_HEIGHT_M + 1.62, "glass"))

    # saloon windows between the doors
    span = 2 * (door_x - DOOR_WIDTH_M) - 0.6
    pitch = span / WINDOW_COUNT
    for i in range(WINDOW_COUNT):
        cx = -span / 2 + (i + 0.5) * pitch
        for sy in (-1, 1):
            parts.append(make_box(
                f"Kiha54_Window_{i:02d}{'L' if sy > 0 else 'R'}",
                cx - WINDOW_WIDTH_M / 2, cx + WINDOW_WIDTH_M / 2,
                sy * (HALF_WIDTH - 0.02), sy * y_out,
                WINDOW_SILL_M, WINDOW_SILL_M + WINDOW_HEIGHT_M, "glass"))
    return parts


def build_cab_fronts():
    """Flat front with a gangway door, the black surround that gives the
    'large window' look, the destination indicator above it, and the white
    FRP frame where the front meets the sides."""
    parts = []
    for sx in (-1, 1):
        x_out = sx * (HALF_LENGTH + 0.012)
        x_in = sx * (HALF_LENGTH - 0.02)
        lo, hi = (x_in, x_out) if sx > 0 else (x_out, x_in)

        parts.append(make_box(f"Kiha54_CabSurround_{sx}", lo, hi,
                              -1.20, 1.20, 2.18, 3.02, "black"))
        parts.append(make_box(f"Kiha54_CabGlassL_{sx}", lo, hi + sx * 0.008,
                              0.14, 1.10, 2.26, 2.94, "glass"))
        parts.append(make_box(f"Kiha54_CabGlassR_{sx}", lo, hi + sx * 0.008,
                              -1.10, -0.14, 2.26, 2.94, "glass"))
        # destination indicator above the cab windows
        parts.append(make_box(f"Kiha54_Destination_{sx}", lo, hi + sx * 0.010,
                              -0.62, 0.62, 3.05, 3.22, "black"))
        # gangway door in the centre of the flat front
        parts.append(make_box(f"Kiha54_Gangway_{sx}", lo, hi,
                              -0.36, 0.36, FLOOR_HEIGHT_M, 2.18, "front"))
        # white FRP frame down the front/side joint
        for sy in (-1, 1):
            parts.append(make_box(f"Kiha54_FRP_{sx}_{sy}", lo, hi + sx * 0.004,
                                  sy * 1.46, sy * 1.30,
                                  UNDERFRAME_BOTTOM_M, ROOF_SHOULDER_M, "white"))
        # skirt below the cab
        parts.append(make_box(f"Kiha54_Skirt_{sx}",
                              sx * (HALF_LENGTH - 0.30), sx * HALF_LENGTH,
                              -1.24, 1.24,
                              UNDERFRAME_BOTTOM_M - SKIRT_DEPTH_M, UNDERFRAME_BOTTOM_M + EMBED,
                              "underframe"))
    return parts


def build_roof_equipment():
    """No air conditioning: push-type ventilators, a gravity water tank and
    the deer whistle under its snow cover."""
    parts = []
    for i in range(6):
        cx = -7.0 + i * 2.8
        parts.append(make_box(f"Kiha54_Vent_{i}", cx - 0.30, cx + 0.30,
                              -0.42, 0.42, CAR_HEIGHT_M - 0.02, CAR_HEIGHT_M + 0.13, "roof"))
    parts.append(make_box("Kiha54_WaterTank", 2.4, 4.6, -0.70, 0.70,
                          CAR_HEIGHT_M - 0.04, CAR_HEIGHT_M + 0.26, "roof"))
    parts.append(make_box("Kiha54_DeerWhistle", -9.2, -8.7, -0.24, 0.24,
                          CAR_HEIGHT_M - 0.02, CAR_HEIGHT_M + 0.18, "roof"))
    return parts


def build_running_gear():
    """Underframe, two bogies and their wheelsets."""
    parts = [make_box("Kiha54_Underframe", -HALF_LENGTH + 0.4, HALF_LENGTH - 0.4,
                      -1.30, 1.30, 0.72, UNDERFRAME_BOTTOM_M + EMBED, "underframe")]
    radius = WHEEL_DIAMETER_M / 2.0
    for sx in (-1, 1):
        bx = sx * BOGIE_CENTRES_M / 2.0
        parts.append(make_box(f"Kiha54_Bogie_{sx}", bx - 1.45, bx + 1.45,
                              -1.05, 1.05, 0.38, 0.80, "underframe"))
        for wx in (bx - BOGIE_WHEELBASE_M / 2, bx + BOGIE_WHEELBASE_M / 2):
            for sy in (-1, 1):
                mesh = bpy.data.meshes.new(f"Kiha54_WheelMesh_{wx:.2f}_{sy}")
                bm = bmesh.new()
                bmesh.ops.create_cone(bm, cap_ends=True, segments=16,
                                      radius1=radius, radius2=radius, depth=0.09)
                bmesh.ops.rotate(bm, verts=bm.verts,
                                 matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "X"))
                bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((wx, sy * 0.53, radius)))
                bm.to_mesh(mesh)
                bm.free()
                obj = bpy.data.objects.new(mesh.name.replace("Mesh", ""), mesh)
                obj.data.materials.append(make_material("wheel"))
                bpy.context.collection.objects.link(obj)
                parts.append(obj)
    return parts


def build_car():
    clear_scene()
    objects = {"body": build_body()}
    for i, part in enumerate(build_side_details()):
        objects[f"side_{i}"] = part
    for i, part in enumerate(build_cab_fronts()):
        objects[f"cab_{i}"] = part
    for i, part in enumerate(build_roof_equipment()):
        objects[f"roof_{i}"] = part
    for i, part in enumerate(build_running_gear()):
        objects[f"gear_{i}"] = part
    return objects


# =====================================================================
def verify(objects):
    print("=== キハ54形500番台 verification ===")
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    tris = 0
    bad = 0
    inward = 0
    for obj in objects.values():
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        mesh.verts.ensure_lookup_table()
        mesh.edges.ensure_lookup_table()
        mesh.faces.ensure_lookup_table()
        tris += sum(len(f.verts) - 2 for f in mesh.faces)
        nm = [e for e in mesh.edges if not e.is_manifold]
        if nm:
            bad += len(nm)
            print(f"  !! {obj.name}: non-manifold edges {len(nm)}")
        signed = mesh.calc_volume(signed=True)
        unsigned = mesh.calc_volume(signed=False)
        if not (signed > 0 and abs(signed - unsigned) < 1e-6):
            inward += 1
            print(f"  !! {obj.name}: signed {signed:+.6f} unsigned {unsigned:.6f}")
        for v in mesh.verts:
            g = (v.co.x, v.co.z, -v.co.y)
            for i in range(3):
                lo[i] = min(lo[i], g[i])
                hi[i] = max(hi[i], g[i])
        mesh.free()

    print(f"objects                {len(objects)}   triangles {tris}")
    print(f"non-manifold edges     {bad}  (0 expected)")
    print(f"inward-facing solids   {inward}  (0 expected)")
    print(f"bbox (Three.js frame)  min=({lo[0]:+.3f}, {lo[1]:+.3f}, {lo[2]:+.3f})  max=({hi[0]:+.3f}, {hi[1]:+.3f}, {hi[2]:+.3f})")
    print(f"  length {hi[0]-lo[0]:.3f} m (spec {CAR_LENGTH_M})   "
          f"height {hi[1]-lo[1]:.3f} m (spec {CAR_HEIGHT_M} + roof equipment)   "
          f"width {hi[2]-lo[2]:.3f} m (spec {CAR_WIDTH_M})")


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True,
                              export_apply=True, use_selection=False,
                              export_cameras=False, export_lights=False)
    print(f"exported GLB: {path} ({os.path.getsize(path)} bytes)")


def render_views(outdir):
    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.60, 0.66, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.samples = 128
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 700
    cam_data = bpy.data.cameras.new("C")
    cam_data.lens = 50
    cam = bpy.data.objects.new("C", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    os.makedirs(outdir, exist_ok=True)
    for label, pos, target in [
        ("01_side", Vector((0, -34, 6)), Vector((0, 0, 2.0))),
        ("02_three_quarter", Vector((-24, -20, 7)), Vector((0, 0, 1.9))),
        ("03_cab", Vector((-19, -7, 4.0)), Vector((-8.5, 0, 2.4))),
    ]:
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"{label}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered:", scene.render.filepath)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--renderdir", default=None)
    args = parser.parse_args(argv)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    out_path = args.out or os.path.join(repo_root, OUTPUT_RELATIVE_PATH)

    objects = build_car()
    verify(objects)
    export_glb(out_path)
    if args.render:
        render_views(args.renderdir or os.path.join(repo_root, "build", "kiha54_qa"))


if __name__ == "__main__":
    main()
