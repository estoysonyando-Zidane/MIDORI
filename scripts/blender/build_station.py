"""
緑駅 (Midori Station, JR Hokkaido Senmo Line, B67) — station building as a
neutral glTF asset.

Run headless:

    blender --background --python scripts/blender/build_station.py
    blender --background --python scripts/blender/build_station.py -- --render

------------------------------------------------------------------------
WHERE THESE NUMBERS COME FROM
------------------------------------------------------------------------
Directive 08-11 built this from MIDORI_STATION_REALITY_SPEC_v1.2, whose
§4.3 states that the main roof's ridge runs perpendicular to the facade and
that the facade therefore shows a gable triangle.

Photographs of the building show the opposite, and this script follows the
photographs:

  * the ridge runs PARALLEL to the facade, along the building's long axis
    (which is itself parallel to the track);
  * the facade shows one broad roof plane with a HORIZONTAL eave and
    horizontal standing seams;
  * the gable ends face LEFT and RIGHT, not front;
  * the only triangle on the facade is the projecting entrance porch —
    which is what the spec appears to have mistaken for the main gable.

Dimensions below were measured off a near-orthographic front elevation
photograph and scaled so that the eave height matches the spec's 3.5 m,
which is the one figure the photograph and the spec agree on. Each value
carries its source in a comment. Nothing here is invented for looks.

------------------------------------------------------------------------
COORDINATE FRAMES
------------------------------------------------------------------------
Blender is Z-up; glTF and Three.js are Y-up. The exporter (export_yup) maps
    blender (x, y, z) -> glTF (x, z, -y)

The building-local frame used by Three.js is
    +X = width (rail-parallel)   +Y = up   +Z = front (plaza side)

so this script models with
    +X = width                   +Z = up   and the FRONT at -Y
    (the platform/track side, where the canopy is, is at +Y)

Origin: centre of the building's ground contact plane.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# =====================================================================
# Overall form — measured from the front elevation photograph
# =====================================================================
FACADE_WIDTH_M = 7.4          # photo: 990 px at the photo's 3.5 m eave scale
BODY_DEPTH_M = 6.0            # spec v1.2 (not contradicted by any photograph)
EAVE_HEIGHT_M = 3.5           # spec v1.2; used as the scale anchor
RIDGE_HEIGHT_M = 4.5          # spec v1.2; photo gives 4.2-4.5
ROOF_OVERHANG_M = 0.45        # photo: roof projects well past the wall on all sides
FOUNDATION_RISE_M = 0.30      # photo: 35 px -> 0.26 m, rounded into spec's 0.3-0.5 range

# The ridge runs along X, so the roof falls across the DEPTH.
ROOF_RUN_M = BODY_DEPTH_M / 2.0                      # 3.0
ROOF_RISE_M = RIDGE_HEIGHT_M - EAVE_HEIGHT_M         # 1.0
ROOF_PITCH_RAD = math.atan2(ROOF_RISE_M, ROOF_RUN_M)  # 18.43 deg

# =====================================================================
# Entrance porch — the steep gable projecting from the centre of the facade
# =====================================================================
PORCH_OUTER_WIDTH_M = 3.00    # photo: 400 px
PORCH_APEX_HEIGHT_M = 5.00    # photo: 680 px — clearly above the main ridge
PORCH_BASE_HEIGHT_M = 2.50    # photo: 335 px
PORCH_PROJECTION_M = 1.00     # spec v1.2; consistent with the 3/4 photographs
PORCH_ROOT_DEPTH_M = 0.80     # how far the gable is carried back into the roof
PORCH_BORDER_M = 0.22         # photo: the dark green barge boards framing the face

# =====================================================================
# Platform-side canopy (ホーム側下屋)
# =====================================================================
CANOPY_PROJECTION_M = 2.75    # spec v1.2 range 2.5-3.0
CANOPY_OUTER_DROP_M = 0.30    # carried from Directive 10
CANOPY_SLAB_THICKNESS_M = 0.12

# Small lean-to over the service/WC door on the left end wall (photo 001, 011)
END_LEANTO_PROJECTION_M = 0.90
END_LEANTO_WIDTH_M = 2.20
END_LEANTO_HEIGHT_M = 2.55
END_LEANTO_DROP_M = 0.18

# =====================================================================
# Interior — so the waiting room can actually be entered
# =====================================================================
WALL_THICKNESS_M = 0.15
CEILING_HEIGHT_M = 2.60       # photo 007/009: ceiling well below the eave
CEILING_SLAB_M = 0.12
DOOR_WIDTH_M = 1.60           # photo: 210 px
DOOR_HEIGHT_M = 2.16          # photo: 290 px
DADO_HEIGHT_M = 1.10          # photo 007/009: wood panelling to about waist/chest
FLOOR_SLAB_M = 0.12

CHAIR_COUNT = 8               # photo 008: eight bucket seats in a row
CHAIR_PITCH_M = 0.52
CHAIR_SEAT_HEIGHT_M = 0.42
CHAIR_WIDTH_M = 0.46
CHAIR_DEPTH_M = 0.44

ROOF_SLAB_M = 0.12

# Construction allowance: parts are nested this far into their neighbours so
# that no two faces of different solids end up exactly coplanar (coplanar
# coincident faces z-fight). Every use is on a hidden junction.
CONSTRUCTION_EMBED_M = 0.02

# =====================================================================
# Materials
# Colours sampled from the photographs. The roof has been repainted at least
# once: it is dark green in the older photographs and red-brown in 2025
# footage. ROOF_COLOUR selects which era this asset represents — that is the
# only line to change to switch eras.
# =====================================================================
ROOF_ERA = "dark_green"       # "dark_green" (older) | "red_brown" (recent)
ROOF_COLOUR = {"dark_green": "#2e4a3c", "red_brown": "#7d4a3a"}[ROOF_ERA]

MATERIALS = {
    #  key                 name                     sRGB hex   roughness  emission
    "siding": ("Siding_PaleMint", "#e9ebdf", 0.90, 0.10),
    "roof": ("Roof_Metal", ROOF_COLOUR, 0.60, 0.00),
    "fascia": ("Fascia_DarkGreen", "#1e3a2c", 0.65, 0.00),
    "porch_face": ("PorchFace_OffWhite", "#f0f0ea", 0.85, 0.10),
    "foundation": ("Foundation_Concrete", "#9a9a92", 1.00, 0.00),
    "plaster": ("Interior_Plaster", "#dfd9c8", 0.95, 0.14),
    "dado": ("Interior_Dado_Wood", "#b08a52", 0.80, 0.08),
    "floor": ("Interior_Floor", "#8e8e88", 0.95, 0.06),
    "ceiling": ("Interior_Ceiling", "#d8d8d0", 0.95, 0.12),
    "steel": ("Chair_Frame_Steel", "#6e7278", 0.45, 0.00),
    "chair_blue": ("Chair_Blue", "#2e6fb7", 0.40, 0.06),
    "chair_red": ("Chair_Red", "#d0402e", 0.40, 0.06),
    "chair_olive": ("Chair_Olive", "#c9c46a", 0.40, 0.06),
    "chair_cream": ("Chair_Cream", "#e8e4d6", 0.40, 0.06),
}
CHAIR_SEQUENCE = ["chair_blue", "chair_red", "chair_olive", "chair_cream"]

# ---------------------------------------------------------------------
# Derived coordinates (Blender frame: +X width, +Y depth with FRONT at -Y, +Z up)
# ---------------------------------------------------------------------
HALF_WIDTH = FACADE_WIDTH_M / 2.0            # 3.70
HALF_DEPTH = BODY_DEPTH_M / 2.0              # 3.00
FRONT_Y = -HALF_DEPTH                        # -3.00  plaza side
REAR_Y = HALF_DEPTH                          # +3.00  platform side

INNER_X = HALF_WIDTH - WALL_THICKNESS_M      # 3.55
INNER_FRONT_Y = FRONT_Y + WALL_THICKNESS_M   # -2.85
INNER_REAR_Y = REAR_Y - WALL_THICKNESS_M     # +2.85

FLOOR_TOP_Z = FOUNDATION_RISE_M              # 0.30
CEILING_BOTTOM_Z = FLOOR_TOP_Z + CEILING_HEIGHT_M   # 2.90

ROOF_EAVE_Y = HALF_DEPTH + ROOF_OVERHANG_M   # 3.45
ROOF_EAVE_Z = RIDGE_HEIGHT_M - ROOF_EAVE_Y * math.tan(ROOF_PITCH_RAD)  # 3.35
ROOF_END_X = HALF_WIDTH + ROOF_OVERHANG_M    # 4.15

# The walls stop at the roof's UNDERSIDE, not at a nominal eave height —
# otherwise the wall's top pokes through the roof slab and draws a seam
# along the whole roof plane.
ROOF_UNDERSIDE_AT_WALL_Z = RIDGE_HEIGHT_M - ROOF_SLAB_M - HALF_DEPTH * math.tan(ROOF_PITCH_RAD)
WALL_TOP_Z = ROOF_UNDERSIDE_AT_WALL_Z + CONSTRUCTION_EMBED_M   # nested up into the roof
WALL_APEX_Z = RIDGE_HEIGHT_M - ROOF_SLAB_M + CONSTRUCTION_EMBED_M

PORCH_HALF_WIDTH = PORCH_OUTER_WIDTH_M / 2.0        # 1.50
PORCH_TIP_Y = FRONT_Y - PORCH_PROJECTION_M          # -4.00
PORCH_ROOT_Y = PORCH_TIP_Y + PORCH_PROJECTION_M + PORCH_ROOT_DEPTH_M  # -2.20

CANOPY_INNER_Y = REAR_Y - CONSTRUCTION_EMBED_M
CANOPY_OUTER_Y = REAR_Y + CANOPY_PROJECTION_M

OUTPUT_RELATIVE_PATH = os.path.join("public", "assets", "models", "midori_station.glb")
TOL = 1e-6


# =====================================================================
# Helpers
# =====================================================================
def srgb_channel_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_string: str, alpha: float = 1.0):
    raw = hex_string.lstrip("#")
    channels = (int(raw[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    r, g, b = (srgb_channel_to_linear(c) for c in channels)
    return (r, g, b, alpha)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def make_material(key: str) -> bpy.types.Material:
    """One datablock per key, reused across objects."""
    name, hex_colour, roughness, emission_strength = MATERIALS[key]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    colour = hex_to_linear_rgba(hex_colour)
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if emission_strength > 0.0:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission_input is not None:
            emission_input.default_value = colour
        strength_input = bsdf.inputs.get("Emission Strength")
        if strength_input is not None:
            strength_input.default_value = emission_strength
    return material


def make_solid(name, profile_points, profile_faces, axis, start, end, material_keys, classify,
               bisect_z=None):
    """Build one closed solid by extruding a flat profile.

    axis 'X' reads the profile as (y, z); 'Y' as (x, z); 'Z' as (x, y).
    Winding is never reasoned about by hand — bmesh recalculates the finished
    solid's normals so they all point outward.
    """
    mesh = bmesh.new()
    verts = []
    for u, v in profile_points:
        if axis == "X":
            co = Vector((start, u, v))
        elif axis == "Y":
            co = Vector((u, start, v))
        else:
            co = Vector((u, v, start))
        verts.append(mesh.verts.new(co))
    mesh.verts.ensure_lookup_table()

    faces = [mesh.faces.new([verts[i] for i in indices]) for indices in profile_faces]
    mesh.normal_update()

    extruded = bmesh.ops.extrude_face_region(mesh, geom=faces)
    moved = [e for e in extruded["geom"] if isinstance(e, bmesh.types.BMVert)]
    offset = end - start
    delta = {"X": Vector((offset, 0, 0)), "Y": Vector((0, offset, 0)), "Z": Vector((0, 0, offset))}[axis]
    bmesh.ops.translate(mesh, verts=moved, vec=delta)

    # Split the solid at a height so faces above and below it can carry
    # different materials — used for the interior's wood dado line, which is
    # otherwise unreachable because a wall is one face from floor to ceiling.
    if bisect_z is not None:
        bmesh.ops.bisect_plane(
            mesh,
            geom=mesh.verts[:] + mesh.edges[:] + mesh.faces[:],
            plane_co=Vector((0.0, 0.0, bisect_z)),
            plane_no=Vector((0.0, 0.0, 1.0)),
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
    for key in material_keys:
        if key not in ordered:
            ordered.append(key)
    for key in ordered:
        obj.data.materials.append(make_material(key))
    for polygon in obj.data.polygons:
        polygon.material_index = ordered.index(classify(polygon.center, polygon.normal))
    obj.data.update()
    return obj


def make_box(name, x0, x1, y0, y1, z0, z1, material_keys, classify, bisect_z=None):
    points = [(y0, z0), (y1, z0), (y1, z1), (y0, z1)]
    return make_solid(name, points, [(0, 1, 2, 3)], "X", x0, x1, material_keys, classify,
                      bisect_z=bisect_z)


def roof_underside_z(y: float) -> float:
    """Height of the main roof's upper surface at depth y."""
    return RIDGE_HEIGHT_M - abs(y) * math.tan(ROOF_PITCH_RAD)


# =====================================================================
# The building
# =====================================================================
def build_foundation():
    """基礎 — the concrete plinth the walls stand on."""
    return make_box(
        "MidoriStation_Foundation",
        -HALF_WIDTH - 0.05, HALF_WIDTH + 0.05,
        FRONT_Y - 0.05, REAR_Y + 0.05,
        0.0, FOUNDATION_RISE_M + CONSTRUCTION_EMBED_M,
        ["foundation"], lambda c, n: "foundation",
    )


def build_floor():
    return make_box(
        "MidoriStation_Floor",
        -INNER_X, INNER_X, INNER_FRONT_Y, INNER_REAR_Y,
        FLOOR_TOP_Z - FLOOR_SLAB_M, FLOOR_TOP_Z,
        ["floor"], lambda c, n: "floor",
    )


def build_ceiling():
    return make_box(
        "MidoriStation_Ceiling",
        -INNER_X, INNER_X, INNER_FRONT_Y, INNER_REAR_Y,
        CEILING_BOTTOM_Z, CEILING_BOTTOM_Z + CEILING_SLAB_M,
        ["ceiling"], lambda c, n: "ceiling",
    )


def wall_classifier(inward: Vector):
    """Exterior faces get siding; interior faces get plaster above the dado
    line and wood panelling below it."""
    def classify(centre, normal):
        if normal.dot(inward) > 0.5:
            return "dado" if centre.z < FLOOR_TOP_Z + DADO_HEIGHT_M else "plaster"
        return "siding"
    return classify


def build_end_wall(name, sign):
    """Left/right end wall, including the gable triangle above the eave.

    The profile is the end elevation — a rectangle up to the eave plus the
    gable triangle up to the ridge — extruded through the wall thickness.
    This is the wall the photographs show facing left and right; the facade
    has no such triangle.
    """
    points = [
        (FRONT_Y, FOUNDATION_RISE_M),
        (REAR_Y, FOUNDATION_RISE_M),
        (REAR_Y, WALL_TOP_Z),
        (0.0, WALL_APEX_Z),
        (FRONT_Y, WALL_TOP_Z),
    ]
    outer = sign * HALF_WIDTH
    inner = sign * (HALF_WIDTH - WALL_THICKNESS_M)
    inward = Vector((-sign, 0.0, 0.0))
    return make_solid(
        name, points, [(0, 1, 2, 3, 4)], "X", outer, inner,
        ["siding", "plaster", "dado"], wall_classifier(inward),
        bisect_z=FLOOR_TOP_Z + DADO_HEIGHT_M,
    )


def build_rear_wall():
    """Platform-side wall."""
    return make_box(
        "MidoriStation_WallRear",
        -INNER_X, INNER_X, INNER_REAR_Y, REAR_Y,
        FOUNDATION_RISE_M, WALL_TOP_Z,
        ["siding", "plaster", "dado"], wall_classifier(Vector((0.0, -1.0, 0.0))),
        bisect_z=FLOOR_TOP_Z + DADO_HEIGHT_M,
    )


def build_front_walls():
    """Facade, built as three pieces around the entrance so the doorway is a
    real opening the player can walk through."""
    half_door = DOOR_WIDTH_M / 2.0
    door_head = FOUNDATION_RISE_M + DOOR_HEIGHT_M
    inward = Vector((0.0, 1.0, 0.0))
    classify = wall_classifier(inward)
    pieces = []
    pieces.append(make_box(
        "MidoriStation_WallFrontLeft",
        -INNER_X, -half_door, FRONT_Y, INNER_FRONT_Y,
        FOUNDATION_RISE_M, WALL_TOP_Z, ["siding", "plaster", "dado"], classify,
        bisect_z=FLOOR_TOP_Z + DADO_HEIGHT_M))
    pieces.append(make_box(
        "MidoriStation_WallFrontRight",
        half_door, INNER_X, FRONT_Y, INNER_FRONT_Y,
        FOUNDATION_RISE_M, WALL_TOP_Z, ["siding", "plaster", "dado"], classify,
        bisect_z=FLOOR_TOP_Z + DADO_HEIGHT_M))
    pieces.append(make_box(
        "MidoriStation_WallFrontLintel",
        -half_door, half_door, FRONT_Y, INNER_FRONT_Y,
        door_head, WALL_TOP_Z, ["siding", "plaster", "dado"], classify))
    return pieces


def build_roof():
    """Main roof — a gable whose RIDGE RUNS ALONG X, parallel to the facade.

    The facade therefore shows one broad plane with a horizontal eave, which
    is what the photographs show and what spec v1.2 §4.3 got backwards.
    """
    thickness = ROOF_SLAB_M
    points = [
        (-ROOF_EAVE_Y, ROOF_EAVE_Z),
        (0.0, RIDGE_HEIGHT_M),
        (ROOF_EAVE_Y, ROOF_EAVE_Z),
        (ROOF_EAVE_Y, ROOF_EAVE_Z - thickness),
        (0.0, RIDGE_HEIGHT_M - thickness),
        (-ROOF_EAVE_Y, ROOF_EAVE_Z - thickness),
    ]

    def classify(centre, normal):
        # The thin edge faces read as the dark green fascia / barge boards
        # that trim the roof in every photograph.
        return "roof" if normal.z > 0.2 else "fascia"

    return make_solid(
        "MidoriStation_Roof", points, [(0, 1, 2, 3, 4, 5)], "X",
        -ROOF_END_X, ROOF_END_X, ["roof", "fascia"], classify,
    )


def build_porch():
    """三角ポーチ — the steep gable projecting forward from the facade centre.

    Its apex stands above the main ridge, and it is the only triangle the
    facade shows. The white face is the pediment carrying 「緑　駅」; the two
    rake faces read as the dark green barge boards that frame it.
    """
    points = [
        (-PORCH_HALF_WIDTH, PORCH_BASE_HEIGHT_M),
        (PORCH_HALF_WIDTH, PORCH_BASE_HEIGHT_M),
        (0.0, PORCH_APEX_HEIGHT_M),
    ]
    body = make_solid(
        "MidoriStation_Porch", points, [(0, 1, 2)], "Y",
        PORCH_TIP_Y, PORCH_ROOT_Y, ["fascia"], lambda c, n: "fascia",
    )

    # The white pediment is inset inside the barge boards, so the boards read
    # as a dark green frame around it — the building's clearest signature.
    # The inset triangle is similar to the outer one, shrunk about its
    # incentre by the board width.
    half = PORCH_HALF_WIDTH
    height = PORCH_APEX_HEIGHT_M - PORCH_BASE_HEIGHT_M
    slope_len = math.hypot(half, height)
    # distance from each edge is PORCH_BORDER_M; scale factor for a triangle
    # inset by a uniform border is 1 - border / inradius
    inradius = (half * height) / (half + slope_len)
    scale = max(0.05, 1.0 - PORCH_BORDER_M / inradius)
    cx = 0.0
    cz = PORCH_BASE_HEIGHT_M + inradius
    inset = [
        (cx + (x - cx) * scale, cz + (z - cz) * scale)
        for x, z in points
    ]
    face = make_solid(
        "MidoriStation_PorchFace", inset, [(0, 1, 2)], "Y",
        PORCH_TIP_Y - 0.03, PORCH_TIP_Y + 0.10,
        ["porch_face"], lambda c, n: "porch_face",
    )
    return [body, face]


def build_canopy():
    """ホーム側下屋 — the single-slope canopy over the platform side."""
    def top_z(y):
        return EAVE_HEIGHT_M - CANOPY_OUTER_DROP_M * (y - REAR_Y) / CANOPY_PROJECTION_M

    inner_top = top_z(CANOPY_INNER_Y)
    outer_top = top_z(CANOPY_OUTER_Y)
    points = [
        (CANOPY_INNER_Y, inner_top),
        (CANOPY_OUTER_Y, outer_top),
        (CANOPY_OUTER_Y, outer_top - CANOPY_SLAB_THICKNESS_M),
        (CANOPY_INNER_Y, inner_top - CANOPY_SLAB_THICKNESS_M),
    ]

    def classify(centre, normal):
        return "roof" if normal.z > 0.2 else "fascia"

    return make_solid(
        "MidoriStation_Canopy", points, [(0, 1, 2, 3)], "X",
        -HALF_WIDTH, HALF_WIDTH, ["roof", "fascia"], classify,
    )


def build_end_leanto():
    """Small lean-to over the service door on the left end wall (photo 001)."""
    outer_x = -HALF_WIDTH - END_LEANTO_PROJECTION_M
    inner_x = -HALF_WIDTH + CONSTRUCTION_EMBED_M
    points = [
        (inner_x, END_LEANTO_HEIGHT_M),
        (outer_x, END_LEANTO_HEIGHT_M - END_LEANTO_DROP_M),
        (outer_x, END_LEANTO_HEIGHT_M - END_LEANTO_DROP_M - 0.10),
        (inner_x, END_LEANTO_HEIGHT_M - 0.10),
    ]

    def classify(centre, normal):
        return "roof" if normal.z > 0.2 else "fascia"

    return make_solid(
        "MidoriStation_EndLeanTo", points, [(0, 1, 2, 3)], "Y",
        -END_LEANTO_WIDTH_M / 2.0, END_LEANTO_WIDTH_M / 2.0,
        ["roof", "fascia"], classify,
    )


def build_chairs():
    """The row of FRP bucket seats along the platform-side wall.

    Photograph 008 shows eight seats on a common steel rail, their colours
    cycling blue / red / olive / cream.
    """
    objects = []
    row_y = INNER_REAR_Y - CHAIR_DEPTH_M / 2.0 - 0.05
    span = (CHAIR_COUNT - 1) * CHAIR_PITCH_M
    x0 = -span / 2.0

    rail = make_box(
        "MidoriStation_ChairRail",
        x0 - CHAIR_WIDTH_M / 2.0, x0 + span + CHAIR_WIDTH_M / 2.0,
        row_y - 0.05, row_y + 0.05,
        FLOOR_TOP_Z + 0.14, FLOOR_TOP_Z + 0.22,
        ["steel"], lambda c, n: "steel",
    )
    objects.append(rail)

    for i in range(CHAIR_COUNT):
        key = CHAIR_SEQUENCE[i % len(CHAIR_SEQUENCE)]
        cx = x0 + i * CHAIR_PITCH_M
        seat_z = FLOOR_TOP_Z + CHAIR_SEAT_HEIGHT_M
        objects.append(make_box(
            f"MidoriStation_ChairSeat_{i:02d}",
            cx - CHAIR_WIDTH_M / 2.0, cx + CHAIR_WIDTH_M / 2.0,
            row_y - CHAIR_DEPTH_M / 2.0, row_y + CHAIR_DEPTH_M / 2.0,
            seat_z, seat_z + 0.06,
            [key], lambda c, n, k=key: k,
        ))
        objects.append(make_box(
            f"MidoriStation_ChairBack_{i:02d}",
            cx - CHAIR_WIDTH_M / 2.0, cx + CHAIR_WIDTH_M / 2.0,
            row_y + CHAIR_DEPTH_M / 2.0 - 0.07, row_y + CHAIR_DEPTH_M / 2.0,
            seat_z + 0.06, seat_z + 0.50,
            [key], lambda c, n, k=key: k,
        ))
    return objects


def build_station():
    clear_scene()
    objects = {
        "foundation": build_foundation(),
        "floor": build_floor(),
        "ceiling": build_ceiling(),
        "wall_left": build_end_wall("MidoriStation_WallLeft", -1),
        "wall_right": build_end_wall("MidoriStation_WallRight", +1),
        "wall_rear": build_rear_wall(),
        "roof": build_roof(),
        "canopy": build_canopy(),
        "end_leanto": build_end_leanto(),
    }
    porch_body, porch_face = build_porch()
    objects["porch"] = porch_body
    objects["porch_face"] = porch_face
    for i, piece in enumerate(build_front_walls()):
        objects[f"wall_front_{i}"] = piece
    for i, piece in enumerate(build_chairs()):
        objects[f"furniture_{i}"] = piece
    return objects


# =====================================================================
# Verification
# =====================================================================
def bmesh_of(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.verts.ensure_lookup_table()
    mesh.edges.ensure_lookup_table()
    mesh.faces.ensure_lookup_table()
    return mesh


def verify(objects):
    def line(text):
        print(text)

    line("=== 緑駅 geometry verification ===")

    roof = bmesh_of(objects["roof"])
    porch = bmesh_of(objects["porch"])
    left = bmesh_of(objects["wall_left"])

    # --- ridge orientation: the single most important correction ----------
    ridge_z = max(v.co.z for v in roof.verts)
    ridge_pts = [v.co for v in roof.verts if abs(v.co.z - ridge_z) < TOL]
    ridge_xs = sorted({round(p.x, 4) for p in ridge_pts})
    ridge_ys = sorted({round(p.y, 4) for p in ridge_pts})
    line(f"ridge height           {ridge_z:.4f} m")
    line(f"ridge runs along X     x from {min(ridge_xs):+.3f} to {max(ridge_xs):+.3f}  (span {max(ridge_xs)-min(ridge_xs):.3f} m)")
    line(f"ridge is at one depth  y values {ridge_ys}  -> ridge is PARALLEL to the facade")

    # --- pitch ------------------------------------------------------------
    slopes = [f for f in roof.faces if f.normal.z > 0.2]
    pitches = sorted(math.degrees(math.acos(min(1.0, abs(f.normal.z)))) for f in slopes)
    line(f"main roof pitch        {[f'{p:.3f}' for p in pitches]} deg  (atan({ROOF_RISE_M}/{ROOF_RUN_M}) = {math.degrees(ROOF_PITCH_RAD):.3f})")

    # --- eave / facade ----------------------------------------------------
    front_eave = [v.co.z for v in roof.verts if abs(v.co.y + ROOF_EAVE_Y) < TOL]
    line(f"front eave height      {min(front_eave):.4f}..{max(front_eave):.4f} m  (horizontal across the facade)")
    line(f"roof plan extent       x +/-{ROOF_END_X:.3f}  y +/-{ROOF_EAVE_Y:.3f}   overhang {ROOF_OVERHANG_M} m")

    # --- gable ends face left/right --------------------------------------
    gable_apex = max(v.co.z for v in left.verts)
    line(f"left end wall apex     {gable_apex:.4f} m  -> the gable triangle faces LEFT, not front")

    # --- porch ------------------------------------------------------------
    porch_apex = max(v.co.z for v in porch.verts)
    porch_base = min(v.co.z for v in porch.verts)
    half_base = max(abs(v.co.x) for v in porch.verts)
    base_angle = math.degrees(math.atan2(porch_apex - porch_base, half_base))
    line(f"porch apex / base      {porch_apex:.3f} m / {porch_base:.3f} m   above the ridge by {porch_apex - ridge_z:+.3f} m")
    line(f"porch triangle         base {2*half_base:.3f} m, base angles {base_angle:.2f} deg, apex {180-2*base_angle:.2f} deg")

    # --- doorway ----------------------------------------------------------
    line(f"doorway opening        {DOOR_WIDTH_M:.2f} m wide x {DOOR_HEIGHT_M:.2f} m high, centred on the facade")
    line(f"interior clear height  {CEILING_HEIGHT_M:.2f} m   floor at {FLOOR_TOP_Z:.2f} m")

    # --- manifold / normals ----------------------------------------------
    bad_total = 0
    volume_bad = 0
    for obj in objects.values():
        mesh = bmesh_of(obj)
        bad = [e for e in mesh.edges if not e.is_manifold]
        boundary = [e for e in mesh.edges if e.is_boundary]
        signed = mesh.calc_volume(signed=True)
        unsigned = mesh.calc_volume(signed=False)
        if bad or boundary:
            bad_total += len(bad) + len(boundary)
            line(f"  !! {obj.name}: non-manifold={len(bad)} boundary={len(boundary)}")
        if not (signed > 0 and abs(signed - unsigned) < 1e-9):
            volume_bad += 1
            line(f"  !! {obj.name}: signed volume {signed:+.6f} != unsigned {unsigned:.6f}")
        mesh.free()
    line(f"objects                {len(objects)}")
    line(f"non-manifold/boundary  {bad_total}  (0 expected)")
    line(f"inward-facing solids   {volume_bad}  (0 expected)")

    # --- bounding box in the exported frame -------------------------------
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    tris = 0
    for obj in objects.values():
        mesh = bmesh_of(obj)
        tris += sum(len(f.verts) - 2 for f in mesh.faces)
        for v in mesh.verts:
            g = (v.co.x, v.co.z, -v.co.y)   # blender -> glTF
            for i in range(3):
                lo[i] = min(lo[i], g[i])
                hi[i] = max(hi[i], g[i])
        mesh.free()
    line(f"bbox (Three.js frame)  min=({lo[0]:+.3f}, {lo[1]:+.3f}, {lo[2]:+.3f})  max=({hi[0]:+.3f}, {hi[1]:+.3f}, {hi[2]:+.3f})")
    line(f"triangles              {tris}")

    roof.free()
    porch.free()
    left.free()


# =====================================================================
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_apply=True,
        use_selection=False, export_cameras=False, export_lights=False,
    )
    print(f"exported GLB: {path} ({os.path.getsize(path)} bytes)")


def setup_neutral_lighting():
    world = bpy.data.worlds.new("NeutralWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.55, 0.60, 0.66, 1.0)
    background.inputs[1].default_value = 0.6

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(52.0), 0.0, math.radians(35.0))
    bpy.context.collection.objects.link(sun)


def render_views(outdir):
    setup_neutral_lighting()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.samples = 192
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 800

    camera_data = bpy.data.cameras.new("QACamera")
    camera_data.lens = 40.0
    camera = bpy.data.objects.new("QACamera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    target = Vector((0.0, 0.0, 2.2))

    views = [
        ("01_front", Vector((0.0, -17.0, 4.5))),
        ("02_front_three_quarter", Vector((-11.0, -13.0, 6.0))),
        ("03_platform_side", Vector((0.0, 17.0, 6.0))),
        ("04_end_left", Vector((-16.0, -2.0, 5.0))),
        ("05_overview", Vector((-13.0, -13.0, 15.0))),
        ("06_doorway", Vector((0.0, -6.5, 1.7))),
    ]
    os.makedirs(outdir, exist_ok=True)
    for label, position in views:
        camera.location = position
        look = (target - position) if label != "06_doorway" else (Vector((0.0, 2.0, 1.6)) - position)
        camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"{label}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered:", scene.render.filepath)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_station.py")
    parser.add_argument("--out", default=None)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--renderdir", default=None)
    args = parser.parse_args(argv)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    out_path = args.out or os.path.join(repo_root, OUTPUT_RELATIVE_PATH)

    objects = build_station()
    verify(objects)
    export_glb(out_path)

    if args.render:
        render_views(args.renderdir or os.path.join(repo_root, "build", "blender_qa"))


if __name__ == "__main__":
    main()
