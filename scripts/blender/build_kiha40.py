"""
キハ40 826 — the railcar photographed standing at 緑駅 on 2009-05-20.

Run headless:

    blender --background --python scripts/blender/build_kiha40.py

------------------------------------------------------------------------
WHY THIS CAR
------------------------------------------------------------------------
Every other vehicle in this World was built from an encyclopedia entry and
a general description. This one was not. SRC_PHOTO_20090520 — File:Kiha40
826.JPG on Wikimedia Commons, public domain, taken 2009-05-20 12:06 — is a
photograph of a JR北海道 キハ40 standing at the platform AT 緑駅, eleven and
a half months before this World's date, with the station's own mural and
駅名標 in the same frame. It is as close to a photograph of the thing on the
day as this project is going to get.

Its number board reads 826 and the underframe lettering reads キハ40 826.
Which 番台 that is, this does not say and neither does anything else read
here, so it is not claimed.

------------------------------------------------------------------------
DIMENSIONS — SOURCED
------------------------------------------------------------------------
国鉄キハ40系気動車 (2代), the 酷寒地形 column of its 主要寸法 table, which is
the specification of every JR北海道 キハ40形:

    全長 21,300 mm / 車体長 19,800 mm
    全幅 2,930 mm  / 車体幅 2,900 mm
    全高 4,055 mm  / 屋根高 3,650 mm / 床面高 1,240 mm
    自重 36.8 t    / 最高速度 95 km/h
    両運転台・トイレ付・片開き2扉・デッキ付
    客室窓は一段上昇式の二重窓
    台車は空気ばねの DT44・TR227 系
    機関 DMF15HSA 220 PS

Livery: 「JR移行後は、地域色を除き外板色が白地に萌黄色と青の帯に統一されて
いた」 — white with a 萌黄 band and blue lines, which is what the photograph
shows.

------------------------------------------------------------------------
THE BAND HEIGHTS — MEASURED, WITH ONE ASSUMPTION STATED
------------------------------------------------------------------------
Read off the photograph by scanning a column of pixels down the side of the
car at a point where it is nearly side-on, and classifying each row by hue.
The scan is anchored on two heights: the roof line at 3,650 mm, which is
sourced, and the body's lower edge at 980 mm, which is NOT — it is ordinary
JNR practice for a 21.3 m car and is inference. Every band height below
therefore carries that assumption; call it ±50 mm.

    upper blue line   3,120 - 3,205 mm
    saloon glass      2,153 - 2,772 mm
    green band        1,533 - 1,810 mm
    lower blue line   1,461 - 1,533 mm

Colours are the mean of the sampled pixels, sunlit and shaded read
separately and reconciled: body white rgb(199,203,201) in sun and
rgb(119,122,121) in shade; green rgb(70-91, 189-193, 80-92); blue
rgb(88,115,217); roof rgb(159,162,166).

Figures marked `# inferred` are standard JNR practice for a 21.3 m car and
are recorded as inference rather than fact.
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
CAR_LENGTH_M = 21.30         # 全長
BODY_LENGTH_M = 19.80        # 車体長
CAR_WIDTH_M = 2.90           # 車体幅
ROOF_HEIGHT_M = 3.65         # 屋根高
OVERALL_HEIGHT_M = 4.055     # 全高, over the roof water-tank cover
FLOOR_HEIGHT_M = 1.24        # 床面高

# =====================================================================
# Standard JNR practice for a 21.3 m car — inference, not from the source
# =====================================================================
BOGIE_CENTRES_M = 14.40      # inferred
BOGIE_WHEELBASE_M = 2.10     # inferred
WHEEL_DIAMETER_M = 0.86      # inferred
UNDERFRAME_BOTTOM_M = 0.98   # inferred; the anchor the band heights rest on
ROOF_SHOULDER_M = 3.22       # inferred, from the 3.65 m roof height

DOOR_WIDTH_M = 0.90          # inferred (片開き is sourced, the width is not)
DOOR_HEIGHT_M = 1.86         # inferred
DOOR_CENTRE_FROM_END_M = 3.05  # inferred: doors inboard of the デッキ

WINDOW_COUNT = 9             # counted in the photograph
WINDOW_WIDTH_M = 0.68        # inferred
WINDOW_SILL_M = 2.153        # measured off the photograph
WINDOW_TOP_M = 2.772         # measured off the photograph

CAB_WINDOW_BOTTOM_M = 2.30   # inferred
CAB_WINDOW_TOP_M = 3.02      # inferred
SKIRT_DEPTH_M = 0.42         # a skirt is visible in the photograph; size inferred

# =====================================================================
# Livery bands, measured off SRC_PHOTO_20090520 (see the header)
# =====================================================================
BLUE_LOWER_BOTTOM = 1.461
BLUE_LOWER_TOP = 1.533
GREEN_TOP = 1.810
BLUE_UPPER_BOTTOM = 3.120
BLUE_UPPER_TOP = 3.205

MATERIALS = {
    #  key            name                     sRGB hex   roughness  metalness
    "white": ("Body_White", "#d8dbd9", 0.52, 0.05),
    "green": ("Band_Moegi", "#3fbe4e", 0.55, 0.00),
    "blue": ("Line_Blue", "#3f5fd0", 0.55, 0.00),
    "roof": ("Roof_Grey", "#9fa2a6", 0.82, 0.10),
    "glass": ("Glass", "#2c3a44", 0.10, 0.30),
    "black": ("Cab_Surround", "#17191c", 0.45, 0.05),
    "underframe": ("Underframe", "#3a3937", 0.85, 0.10),
    "wheel": ("Wheel_Steel", "#4a4d51", 0.55, 0.60),
    "lamp": ("Head_Lamp", "#e8e4d2", 0.25, 0.10),
    "tail": ("Tail_Lamp", "#7d1d18", 0.35, 0.05),
}

OUTPUT_RELATIVE_PATH = os.path.join("public", "assets", "models", "kiha40.glb")

HALF_LENGTH = CAR_LENGTH_M / 2.0
HALF_WIDTH = CAR_WIDTH_M / 2.0
EMBED = 0.01
TOL = 1e-6
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
    """The carbody. キハ40 has a plain steel body with a slight tumblehome at
    the skirt line and a cambered roof; the livery is carried as material
    bands, cut at the measured heights."""
    profile = [
        (-HALF_WIDTH, UNDERFRAME_BOTTOM_M),
        (HALF_WIDTH, UNDERFRAME_BOTTOM_M),
        (HALF_WIDTH, ROOF_SHOULDER_M),
        (1.06, ROOF_HEIGHT_M - 0.08),
        (0.52, ROOF_HEIGHT_M),
        (-0.52, ROOF_HEIGHT_M),
        (-1.06, ROOF_HEIGHT_M - 0.08),
        (-HALF_WIDTH, ROOF_SHOULDER_M),
    ]

    def classify(centre, normal):
        if abs(normal.x) > 0.9:
            return "white"                       # the two cab ends
        if centre.z > ROOF_SHOULDER_M - 0.01:
            return "roof"
        if centre.z < BLUE_LOWER_BOTTOM:
            return "white"
        if centre.z < BLUE_LOWER_TOP:
            return "blue"
        if centre.z < GREEN_TOP:
            return "green"
        if centre.z < BLUE_UPPER_BOTTOM:
            return "white"
        if centre.z < BLUE_UPPER_TOP:
            return "blue"
        return "white"

    return make_solid(
        "Kiha40_Body", profile, [tuple(range(len(profile)))], "X",
        -HALF_LENGTH, HALF_LENGTH,
        ["white", "green", "blue", "roof"], classify,
        bisect_z=[BLUE_LOWER_BOTTOM, BLUE_LOWER_TOP, GREEN_TOP,
                  BLUE_UPPER_BOTTOM, BLUE_UPPER_TOP],
    )


def build_side_details():
    """One single-leaf door near each end of each side, and the row of small
    double-glazed saloon windows between them."""
    parts = []
    y_out = HALF_WIDTH + 0.012

    door_x = HALF_LENGTH - DOOR_CENTRE_FROM_END_M
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = sx * door_x
            tag = f"{'F' if sx > 0 else 'R'}{'L' if sy > 0 else 'R'}"
            parts.append(make_box(
                f"Kiha40_Door_{tag}",
                cx - DOOR_WIDTH_M / 2, cx + DOOR_WIDTH_M / 2,
                sy * (HALF_WIDTH - 0.02), sy * y_out,
                FLOOR_HEIGHT_M, FLOOR_HEIGHT_M + DOOR_HEIGHT_M, "white"))
            parts.append(make_box(
                f"Kiha40_DoorGlass_{tag}",
                cx - 0.30, cx + 0.30,
                sy * (HALF_WIDTH + 0.006), sy * (y_out + 0.006),
                FLOOR_HEIGHT_M + 0.86, WINDOW_TOP_M, "glass"))

    # the saloon windows run between the two doors
    span = 2 * (door_x - DOOR_WIDTH_M / 2) - 0.5
    pitch = span / WINDOW_COUNT
    for i in range(WINDOW_COUNT):
        cx = -span / 2 + (i + 0.5) * pitch
        for sy in (-1, 1):
            parts.append(make_box(
                f"Kiha40_Window_{i:02d}{'L' if sy > 0 else 'R'}",
                cx - WINDOW_WIDTH_M / 2, cx + WINDOW_WIDTH_M / 2,
                sy * (HALF_WIDTH - 0.02), sy * y_out,
                WINDOW_SILL_M, WINDOW_TOP_M, "glass"))
    return parts


def build_cab_fronts():
    """貫通型: a gangway door up the middle, two cab windows either side of
    it, round headlights at the top corners and tail lights below them —
    which is what the photograph shows of the near end."""
    parts = []
    for sx in (-1, 1):
        x_out = sx * (HALF_LENGTH + 0.012)
        x_in = sx * (HALF_LENGTH - 0.02)
        lo, hi = (x_in, x_out) if sx > 0 else (x_out, x_in)

        # the black window surround, split by the gangway door
        for sy in (-1, 1):
            parts.append(make_box(f"Kiha40_CabSurround_{sx}_{sy}", lo, hi,
                                  sy * 0.30, sy * 1.24,
                                  CAB_WINDOW_BOTTOM_M - 0.10, CAB_WINDOW_TOP_M + 0.10, "black"))
            parts.append(make_box(f"Kiha40_CabGlass_{sx}_{sy}", lo, hi + sx * 0.008,
                                  sy * 0.36, sy * 1.18,
                                  CAB_WINDOW_BOTTOM_M, CAB_WINDOW_TOP_M, "glass"))
        # gangway door up the middle
        parts.append(make_box(f"Kiha40_Gangway_{sx}", lo, hi,
                              -0.34, 0.34, FLOOR_HEIGHT_M, CAB_WINDOW_TOP_M, "white"))
        # ワンマン板 above the cab, in the raised centre of the front
        parts.append(make_box(f"Kiha40_OneManBoard_{sx}", lo, hi + sx * 0.010,
                              -0.52, 0.52, CAB_WINDOW_TOP_M + 0.06, CAB_WINDOW_TOP_M + 0.28, "black"))
        # headlights at the top corners, tail lights below
        for sy in (-1, 1):
            parts.append(make_box(f"Kiha40_Head_{sx}_{sy}", lo, hi + sx * 0.045,
                                  sy * 1.02, sy * 1.28,
                                  CAB_WINDOW_TOP_M + 0.10, CAB_WINDOW_TOP_M + 0.36, "lamp"))
            parts.append(make_box(f"Kiha40_Tail_{sx}_{sy}", lo, hi + sx * 0.035,
                                  sy * 1.06, sy * 1.24, 1.86, 2.04, "tail"))
        # skirt under the cab
        parts.append(make_box(f"Kiha40_Skirt_{sx}",
                              sx * (HALF_LENGTH - 0.34), sx * HALF_LENGTH,
                              -1.22, 1.22,
                              UNDERFRAME_BOTTOM_M - SKIRT_DEPTH_M, UNDERFRAME_BOTTOM_M + EMBED,
                              "underframe"))
    return parts


def build_roof_equipment():
    """No air conditioning. Push-type ventilators along the roof, and the
    水タンク under its cover at one end — 屋根上キセ内 for this batch, and
    the reason 全高 is 4,055 mm rather than the 3,895 mm of the cars whose
    tank moved indoors."""
    parts = []
    for i in range(6):
        cx = -6.6 + i * 2.6
        parts.append(make_box(f"Kiha40_Vent_{i}", cx - 0.28, cx + 0.28,
                              -0.40, 0.40, ROOF_HEIGHT_M - 0.02, ROOF_HEIGHT_M + 0.12, "roof"))
    parts.append(make_box("Kiha40_WaterTankCover", 5.9, 8.3, -0.72, 0.72,
                          ROOF_HEIGHT_M - 0.04, OVERALL_HEIGHT_M, "roof"))
    parts.append(make_box("Kiha40_Exhaust", -8.6, -8.2, 0.52, 0.86,
                          ROOF_HEIGHT_M - 0.02, ROOF_HEIGHT_M + 0.22, "roof"))
    return parts


def build_running_gear():
    """Underframe, the two air-spring bogies and their wheelsets."""
    parts = [make_box("Kiha40_Underframe", -HALF_LENGTH + 0.5, HALF_LENGTH - 0.5,
                      -1.28, 1.28, 0.74, UNDERFRAME_BOTTOM_M + EMBED, "underframe")]
    radius = WHEEL_DIAMETER_M / 2.0
    for sx in (-1, 1):
        bx = sx * BOGIE_CENTRES_M / 2.0
        parts.append(make_box(f"Kiha40_Bogie_{sx}", bx - 1.48, bx + 1.48,
                              -1.04, 1.04, 0.36, 0.82, "underframe"))
        for wx in (bx - BOGIE_WHEELBASE_M / 2, bx + BOGIE_WHEELBASE_M / 2):
            for sy in (-1, 1):
                mesh = bpy.data.meshes.new(f"Kiha40_WheelMesh_{wx:.2f}_{sy}")
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
    print("=== キハ40 826 (JR北海道 酷寒地形) verification ===")
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
          f"height {hi[1]-lo[1]:.3f} m (spec {ROOF_HEIGHT_M} + roof equipment)   "
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


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True,
                              export_apply=True, use_selection=False,
                              export_cameras=False, export_lights=False)
    print(f"exported GLB: {path} ({os.path.getsize(path)} bytes)")


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
        render_views(args.renderdir or os.path.join(repo_root, "build", "kiha40_qa"))


if __name__ == "__main__":
    main()
