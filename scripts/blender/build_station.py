"""
Directive 11: build the 緑駅 (Midori Station) station building as a neutral
glTF asset, replacing the procedural TypeScript mesh generation.

Run headless:

    blender --background --python scripts/blender/build_station.py
    blender --background --python scripts/blender/build_station.py -- --render

Every dimension below comes from MIDORI_STATION_REALITY_SPEC_v1.2 (via
Directive 11 §3.1). Nothing here is invented from photographs, from general
knowledge of Japanese station buildings, or for visual effect.

Directive 11 §0: this script does not change the shape. It reproduces the
geometry Directive 10 verified numerically, built a different way.

------------------------------------------------------------------------
COORDINATE FRAMES
------------------------------------------------------------------------
Blender is Z-up; glTF and Three.js are Y-up. The glTF exporter (export_yup)
maps  blender (x, y, z) -> glTF (x, z, -y).

Directive 10's building-local frame in Three.js is:
    +X = width (rail-parallel)   +Y = up   +Z = front (porch / plaza side)

so this script models in Blender with:
    +X = width                   +Z = up   and the FRONT of the building at -Y
    (the platform/track side, where the canopy is, is therefore at +Y)

The origin is the centre of the building's ground contact plane
(Directive 11 §3.3): x = 0, y = 0, z = 0 sits at the centre of the
foundation's underside.

------------------------------------------------------------------------
WHY CLOSED SOLIDS
------------------------------------------------------------------------
Directive 10 built the roof, canopy and porch as open surface shells (no
underside, no back cap). Directive 11 §5.1 requires zero non-manifold edges
and outward normals, and an open shell's boundary edges are non-manifold by
definition. So each part here is a closed solid whose OUTER surfaces are the
same surfaces Directive 10 produced. Two consequences, both improvements
rather than shape changes:

  * the main body and the main roof are one solid, so the roof's lower edge
    and the wall's top edge cannot be separated by construction;
  * the porch gains an underside and a back cap, closing a hole that was
    visible through Directive 10's open porch shell from above.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# =====================================================================
# Dimensions — MIDORI_STATION_REALITY_SPEC_v1.2 §3.1 (Directive 11 §3.1)
# =====================================================================
FACADE_WIDTH_M = 7.0          # 正面幅（線路と平行）
BODY_DEPTH_M = 6.0            # 本体奥行（線路と直角）
EAVE_HEIGHT_M = 3.5           # 軒高
RIDGE_HEIGHT_M = 4.5          # 主屋根の棟高
PORCH_APEX_HEIGHT_M = 4.8     # 三角ポーチ頂部高
PORCH_FACADE_WIDTH_M = 2.6    # 三角ポーチ正面幅
PORCH_PROJECTION_M = 1.0      # 三角ポーチ突出量
PORCH_BASE_HEIGHT_M = 2.6     # 三角ポーチ底辺高

# The spec gives these as ranges. Both values are the ones Directive 10
# already used and verified, kept identical so the shape does not change.
CANOPY_PROJECTION_M = 2.75    # ホーム側下屋の張り出し（仕様 2.5–3.0 m）
FOUNDATION_RISE_M = 0.4       # 基礎立上り（仕様 0.3–0.5 m）

# =====================================================================
# Values the spec does not state, carried over unchanged from Directive 10
# so that this Directive alters no shape. They are NOT spec-derived.
# =====================================================================
FOUNDATION_PLAN_RATIO = 0.98   # foundation footprint vs the body footprint
CANOPY_OUTER_DROP_M = 0.30     # canopy's outer edge sits this far below the eave
PORCH_TRIM_THICKNESS_M = 0.06  # 濃緑の縁取り (spec §4.4 names it, gives no size)
PORCH_TRIM_OVERSIZE_M = 0.05   # trim's plan size beyond the porch footprint

# =====================================================================
# Construction allowance — not a spec value and not a shape value.
# Each part is nested this far into its neighbour so that no two faces of
# different solids end up exactly coplanar. Coplanar coincident faces
# z-fight when rendered. Every use is on a hidden junction, and the
# building's overall bounding box is unchanged by it.
# =====================================================================
CONSTRUCTION_EMBED_M = 0.02

# Thickness given to the canopy purely so that it is a closed solid rather
# than a zero-thickness sheet. It is extruded DOWNWARD from the canopy
# surface Directive 10 produced, so the visible upper surface and the
# silhouette are unchanged.
CANOPY_SLAB_THICKNESS_M = 0.12

# =====================================================================
# Materials — spec v1.2 §4.2 / §4.4 / §4.5 (Directive 11 §3.4)
# Colours are the sRGB hex values Directive 10 shipped, so the asset keeps
# the appearance that was already reviewed. There is no grey wall material.
# =====================================================================
MATERIALS = {
    #  name                    sRGB hex   roughness  emission strength
    "wall": ("Wall_Cream", "#e8dfc8", 0.90, 0.12),
    "roof": ("Roof_DarkGreen", "#1f3d2b", 0.70, 0.00),
    "porch_gable": ("PorchGable_OffWhite", "#f2efe6", 0.85, 0.12),
    "trim": ("PorchTrim_DarkGreen", "#1f3d2b", 0.60, 0.00),
    "foundation": ("Foundation_Concrete", "#9a9a92", 1.00, 0.00),
}
# The emission strengths reproduce Directive 10's Visual QA fix: a small
# emissive term of the material's own colour, so a cream wall still reads as
# cream on faces turned away from a single directional sun instead of
# shading down to flat grey. It is not a spec value.

# ---------------------------------------------------------------------
# Derived coordinates (all in the Blender frame described above)
# ---------------------------------------------------------------------
HALF_WIDTH = FACADE_WIDTH_M / 2.0                     # 3.5
HALF_DEPTH = BODY_DEPTH_M / 2.0                       # 3.0
PORCH_HALF_WIDTH = PORCH_FACADE_WIDTH_M / 2.0         # 1.3

FRONT_FACE_Y = -HALF_DEPTH                            # -3.0  (porch / plaza side)
REAR_FACE_Y = +HALF_DEPTH                             # +3.0  (platform / track side)
PORCH_TIP_Y = FRONT_FACE_Y - PORCH_PROJECTION_M       # -4.0
PORCH_REAR_Y = FRONT_FACE_Y + CONSTRUCTION_EMBED_M    # -2.98 (nested into the body)
CANOPY_INNER_Y = REAR_FACE_Y - CONSTRUCTION_EMBED_M   # +2.98 (nested into the body)
CANOPY_OUTER_Y = REAR_FACE_Y + CANOPY_PROJECTION_M    # +5.75

FOUNDATION_HALF_WIDTH = FACADE_WIDTH_M * FOUNDATION_PLAN_RATIO / 2.0   # 3.43
FOUNDATION_HALF_DEPTH = BODY_DEPTH_M * FOUNDATION_PLAN_RATIO / 2.0     # 2.94
FOUNDATION_TOP_Z = FOUNDATION_RISE_M + CONSTRUCTION_EMBED_M            # 0.42

TRIM_HALF_WIDTH = (PORCH_FACADE_WIDTH_M + PORCH_TRIM_OVERSIZE_M) / 2.0  # 1.325
TRIM_BOTTOM_Z = PORCH_BASE_HEIGHT_M + CONSTRUCTION_EMBED_M              # 2.62
TRIM_TOP_Z = TRIM_BOTTOM_Z + PORCH_TRIM_THICKNESS_M                    # 2.68
TRIM_NEAR_Y = FRONT_FACE_Y + PORCH_TRIM_OVERSIZE_M / 2.0               # -2.975
TRIM_FAR_Y = PORCH_TIP_Y - PORCH_TRIM_OVERSIZE_M / 2.0                 # -4.025

OUTPUT_RELATIVE_PATH = os.path.join("public", "assets", "models", "midori_station.glb")

TOL = 1e-6


# =====================================================================
# Helpers
# =====================================================================
def srgb_channel_to_linear(value: float) -> float:
    """glTF baseColorFactor is linear; the spec colours are written as sRGB."""
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
    """One material datablock per key, reused across objects — otherwise the
    same colour is exported several times over as Roof_DarkGreen.001 etc."""
    name, hex_colour, roughness, emission_strength = MATERIALS[key]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    # glTF exports doubleSided = not use_backface_culling; single-sided keeps
    # the interior faces of these solids from ever being drawn.
    material.use_backface_culling = True

    bsdf = material.node_tree.nodes["Principled BSDF"]
    colour = hex_to_linear_rgba(hex_colour)
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0

    if emission_strength > 0.0:
        # Blender 4.x names it "Emission Color"; 3.x named it "Emission".
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission_input is not None:
            emission_input.default_value = colour
        strength_input = bsdf.inputs.get("Emission Strength")
        if strength_input is not None:
            strength_input.default_value = emission_strength
    return material


def make_solid(name, profile_points, profile_faces, axis, start, end, materials, classify):
    """Build one closed solid by extruding a flat profile.

    profile_points  list of (u, v) points making up the profile
    profile_faces   list of index tuples into profile_points; several faces
                    may share an edge, which is how the body's front/rear
                    elevation is split into a wall part and a gable part so
                    each can carry its own material
    axis            'X' or 'Y', the extrusion direction. For 'Y' the profile
                    is read as (x, z); for 'X' it is read as (y, z).
    start, end      extrusion range along that axis
    classify        called with (face_centre, face_normal) -> key into
                    `materials`, deciding each face's material

    Winding is not reasoned about by hand anywhere: bmesh recalculates the
    normals of the finished closed solid so they all point outward. Getting
    that wrong by hand is what broke Directive 08.
    """
    mesh = bmesh.new()

    verts = []
    for u, v in profile_points:
        position = Vector((u, start, v)) if axis == "Y" else Vector((start, u, v))
        verts.append(mesh.verts.new(position))
    mesh.verts.ensure_lookup_table()

    faces = [mesh.faces.new([verts[i] for i in indices]) for indices in profile_faces]
    mesh.normal_update()

    extruded = bmesh.ops.extrude_face_region(mesh, geom=faces)
    moved = [element for element in extruded["geom"] if isinstance(element, bmesh.types.BMVert)]
    offset = end - start
    delta = Vector((0.0, offset, 0.0)) if axis == "Y" else Vector((offset, 0.0, 0.0))
    bmesh.ops.translate(mesh, verts=moved, vec=delta)

    mesh.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces[:])

    data = bpy.data.meshes.new(name)
    mesh.to_mesh(data)
    mesh.free()

    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)

    material_keys = []
    for key in materials:
        if key not in material_keys:
            material_keys.append(key)
    for key in material_keys:
        obj.data.materials.append(make_material(key))

    for polygon in obj.data.polygons:
        centre = polygon.center
        key = classify(centre, polygon.normal)
        polygon.material_index = material_keys.index(key)

    obj.data.update()
    return obj


def canopy_surface_z(y: float) -> float:
    """Height of the canopy's upper surface at depth `y`.

    Defined by the two points Directive 10 used: it meets the wall at the
    eave (y = REAR_FACE_Y, z = EAVE_HEIGHT_M) and falls CANOPY_OUTER_DROP_M
    over CANOPY_PROJECTION_M of projection.
    """
    return EAVE_HEIGHT_M - CANOPY_OUTER_DROP_M * (y - REAR_FACE_Y) / CANOPY_PROJECTION_M


# =====================================================================
# The building
# =====================================================================
def build_foundation():
    """基礎立上り — the concrete plinth (spec §4.2)."""
    points = [
        (-FOUNDATION_HALF_WIDTH, 0.0),
        (FOUNDATION_HALF_WIDTH, 0.0),
        (FOUNDATION_HALF_WIDTH, FOUNDATION_TOP_Z),
        (-FOUNDATION_HALF_WIDTH, FOUNDATION_TOP_Z),
    ]
    return make_solid(
        "MidoriStation_Foundation",
        points,
        [(0, 1, 2, 3)],
        "Y",
        -FOUNDATION_HALF_DEPTH,
        FOUNDATION_HALF_DEPTH,
        ["foundation"],
        lambda centre, normal: "foundation",
    )


def build_body_and_roof():
    """外壁 + 主屋根 as a single solid.

    The profile is the building's gable elevation, extruded along the depth
    axis — so the ridge runs along the depth direction, perpendicular to the
    facade, and the facade shows the gable as a triangle (spec v1.2 §4.3).

    The profile is split into a wall face and a gable face sharing the eave
    edge, purely so the two can carry different materials.
    """
    points = [
        (-HALF_WIDTH, FOUNDATION_RISE_M),   # 0  wall foot, left
        (HALF_WIDTH, FOUNDATION_RISE_M),    # 1  wall foot, right
        (HALF_WIDTH, EAVE_HEIGHT_M),        # 2  eave, right
        (-HALF_WIDTH, EAVE_HEIGHT_M),       # 3  eave, left
        (0.0, RIDGE_HEIGHT_M),              # 4  ridge
    ]
    faces = [(0, 1, 2, 3), (3, 2, 4)]

    def classify(centre, normal):
        # Everything above the eave line is roof: the two slopes and the two
        # gable ends. Directive 10 gave the gable ends the roof material too;
        # spec v1.2 does not state a colour for them (see the report).
        return "roof" if centre.z > EAVE_HEIGHT_M + TOL else "wall"

    return make_solid(
        "MidoriStation_BodyRoof",
        points,
        faces,
        "Y",
        FRONT_FACE_Y,
        REAR_FACE_Y,
        ["wall", "roof"],
        classify,
    )


def build_porch():
    """三角ポーチ — the small gable projecting from the facade (spec §4.3).

    An isosceles triangle that narrows to a single apex, extruded forward
    from inside the front wall to the porch tip.
    """
    points = [
        (-PORCH_HALF_WIDTH, PORCH_BASE_HEIGHT_M),
        (PORCH_HALF_WIDTH, PORCH_BASE_HEIGHT_M),
        (0.0, PORCH_APEX_HEIGHT_M),
    ]

    def classify(centre, normal):
        # The face at the tip is the 妻面 the plaza sees: white/off-white.
        if centre.y < PORCH_TIP_Y + TOL:
            return "porch_gable"
        return "roof"

    return make_solid(
        "MidoriStation_Porch",
        points,
        [(0, 1, 2)],
        "Y",
        PORCH_TIP_Y,
        PORCH_REAR_Y,
        ["roof", "porch_gable"],
        classify,
    )


def build_porch_trim():
    """濃緑の縁取り at the porch's base (spec §4.4 names it; no size given)."""
    points = [
        (-TRIM_HALF_WIDTH, TRIM_BOTTOM_Z),
        (TRIM_HALF_WIDTH, TRIM_BOTTOM_Z),
        (TRIM_HALF_WIDTH, TRIM_TOP_Z),
        (-TRIM_HALF_WIDTH, TRIM_TOP_Z),
    ]
    return make_solid(
        "MidoriStation_PorchTrim",
        points,
        [(0, 1, 2, 3)],
        "Y",
        TRIM_NEAR_Y,
        TRIM_FAR_Y,
        ["trim"],
        lambda centre, normal: "trim",
    )


def build_canopy():
    """ホーム側下屋 — the single-slope canopy over the platform side.

    A slab whose upper surface is the plane Directive 10 used, given
    thickness downward so it is a closed solid.
    """
    inner_top = canopy_surface_z(CANOPY_INNER_Y)
    outer_top = canopy_surface_z(CANOPY_OUTER_Y)
    points = [
        (CANOPY_INNER_Y, inner_top),
        (CANOPY_OUTER_Y, outer_top),
        (CANOPY_OUTER_Y, outer_top - CANOPY_SLAB_THICKNESS_M),
        (CANOPY_INNER_Y, inner_top - CANOPY_SLAB_THICKNESS_M),
    ]
    return make_solid(
        "MidoriStation_Canopy",
        points,
        [(0, 1, 2, 3)],
        "X",
        -HALF_WIDTH,
        HALF_WIDTH,
        ["roof"],
        lambda centre, normal: "roof",
    )


def build_station():
    clear_scene()
    return {
        "foundation": build_foundation(),
        "body_roof": build_body_and_roof(),
        "porch": build_porch(),
        "porch_trim": build_porch_trim(),
        "canopy": build_canopy(),
    }


# =====================================================================
# Verification — Directive 11 §5.1
# =====================================================================
def bmesh_of(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.verts.ensure_lookup_table()
    mesh.edges.ensure_lookup_table()
    mesh.faces.ensure_lookup_table()
    return mesh


def x_extent_at_z(mesh, z):
    """Measure a solid's width at height z by interpolating along its edges.

    Measured from the mesh that was actually built, not recomputed from the
    constants it was built from.
    """
    xs = []
    for vert in mesh.verts:
        if abs(vert.co.z - z) < 1e-9:
            xs.append(vert.co.x)
    for edge in mesh.edges:
        a, b = edge.verts[0].co, edge.verts[1].co
        if (a.z - z) * (b.z - z) < 0.0:
            t = (z - a.z) / (b.z - a.z)
            xs.append(a.x + t * (b.x - a.x))
    if not xs:
        return None
    return max(xs) - min(xs)


def verify(objects):
    report = []

    def line(text):
        report.append(text)
        print(text)

    line("=== Directive 11 §5.1 numeric verification (inside Blender) ===")

    body = bmesh_of(objects["body_roof"])
    porch = bmesh_of(objects["porch"])
    canopy = bmesh_of(objects["canopy"])

    # ---- 1. eave height -------------------------------------------------
    eave_candidates = [v.co.z for v in body.verts if abs(abs(v.co.x) - HALF_WIDTH) < TOL]
    measured_eave = max(eave_candidates)
    line(f"1. eave height            measured={measured_eave:.6f} m  spec={EAVE_HEIGHT_M} m  diff={measured_eave - EAVE_HEIGHT_M:+.9f}")

    # ---- 2. ridge height ------------------------------------------------
    measured_ridge = max(v.co.z for v in body.verts)
    ridge_xs = sorted({round(v.co.x, 9) for v in body.verts if abs(v.co.z - measured_ridge) < TOL})
    line(f"2. ridge height           measured={measured_ridge:.6f} m  spec={RIDGE_HEIGHT_M} m  diff={measured_ridge - RIDGE_HEIGHT_M:+.9f}  ridge line at x={ridge_xs}")

    # ---- 3. porch apex --------------------------------------------------
    measured_apex = max(v.co.z for v in porch.verts)
    apex_xs = sorted({round(v.co.x, 9) for v in porch.verts if abs(v.co.z - measured_apex) < TOL})
    line(f"3. porch apex height      measured={measured_apex:.6f} m  spec={PORCH_APEX_HEIGHT_M} m  diff={measured_apex - PORCH_APEX_HEIGHT_M:+.9f}  apex at x={apex_xs}")

    # ---- 4. main roof pitch ---------------------------------------------
    slope_faces = [f for f in body.faces if f.calc_center_median().z > EAVE_HEIGHT_M + TOL and abs(f.normal.z) > TOL and abs(f.normal.y) < TOL]
    pitches = sorted(math.degrees(math.acos(min(1.0, abs(f.normal.z)))) for f in slope_faces)
    analytic_pitch = math.degrees(math.atan2(RIDGE_HEIGHT_M - EAVE_HEIGHT_M, HALF_WIDTH))
    line(f"4. main roof pitch        measured from face normals={[f'{p:.4f}' for p in pitches]} deg  spec=about 16 deg  (atan({RIDGE_HEIGHT_M - EAVE_HEIGHT_M}/{HALF_WIDTH})={analytic_pitch:.4f} deg)")

    # ---- 5. roof lower edge meets wall top ------------------------------
    wall_top = max(f.calc_center_median().z + 0.0 for f in body.faces if f.calc_center_median().z <= EAVE_HEIGHT_M + TOL)
    eave_edges = [e for e in body.edges
                  if all(abs(abs(v.co.x) - HALF_WIDTH) < TOL and abs(v.co.z - EAVE_HEIGHT_M) < TOL for v in e.verts)]
    shared_ok = []
    for edge in eave_edges:
        keys = {("roof" if f.calc_center_median().z > EAVE_HEIGHT_M + TOL else "wall") for f in edge.link_faces}
        shared_ok.append((len(edge.link_faces), sorted(keys)))
    roof_low = min(v.co.z for f in body.faces if f.calc_center_median().z > EAVE_HEIGHT_M + TOL for v in f.verts)
    wall_high = max(v.co.z for f in body.faces if f.calc_center_median().z <= EAVE_HEIGHT_M + TOL for v in f.verts)
    line(f"5. roof/wall continuity   roof lowest z={roof_low:.6f}  wall highest z={wall_high:.6f}  gap={roof_low - wall_high:+.9f} m")
    line(f"   eave edges shared by both: {shared_ok}  (one solid: the roof and the wall cannot separate)")

    # ---- 6. roof left/right symmetry ------------------------------------
    body_points = [(round(v.co.x, 9), round(v.co.y, 9), round(v.co.z, 9)) for v in body.verts]
    mirrored = [(round(-x, 9), y, z) for (x, y, z) in body_points]
    symmetric = sorted(body_points) == sorted(mirrored)
    slope_areas = sorted(f.calc_area() for f in slope_faces)
    line(f"6. roof symmetry          vertex set invariant under x -> -x: {symmetric}   slope face areas={[f'{a:.6f}' for a in slope_areas]}  delta={slope_areas[-1] - slope_areas[0]:+.9f}")

    # ---- 7. porch narrows upward ----------------------------------------
    samples = [PORCH_BASE_HEIGHT_M, 3.0, 3.5, 4.0, 4.5, PORCH_APEX_HEIGHT_M]
    widths = [(z, x_extent_at_z(porch, z)) for z in samples]
    widths_only = [w for _, w in widths if w is not None]
    monotonic = all(widths_only[i] > widths_only[i + 1] - 1e-9 for i in range(len(widths_only) - 1))
    line("7. porch section width    " + "  ".join(f"z={z:.2f}:{w:.4f}m" for z, w in widths if w is not None))
    line(f"   strictly narrowing with height: {monotonic}   (an inverted trapezoid would widen)")

    # ---- 8. porch integrated with the body ------------------------------
    porch_rear = max(v.co.y for v in porch.verts)
    overlap = porch_rear - FRONT_FACE_Y
    line(f"8. porch/body junction    porch rear face y={porch_rear:.6f}  body front face y={FRONT_FACE_Y:.6f}  porch penetrates the body by {overlap:+.6f} m (separation would be negative)")

    # ---- 9. non-manifold edges ------------------------------------------
    line("9. non-manifold check")
    total_non_manifold = 0
    for name, obj in objects.items():
        mesh = bmesh_of(obj)
        bad_edges = [e for e in mesh.edges if not e.is_manifold]
        boundary = [e for e in mesh.edges if e.is_boundary]
        wire = [e for e in mesh.edges if e.is_wire]
        bad_verts = [v for v in mesh.verts if not v.is_manifold]
        total_non_manifold += len(bad_edges) + len(bad_verts)
        line(f"   {obj.name:34s} verts={len(mesh.verts):3d} edges={len(mesh.edges):3d} faces={len(mesh.faces):3d}  non-manifold edges={len(bad_edges)}  boundary edges={len(boundary)}  wire edges={len(wire)}  non-manifold verts={len(bad_verts)}")
        mesh.free()
    line(f"   total non-manifold elements across all objects: {total_non_manifold}")

    # ---- 10. outward normals --------------------------------------------
    # For a closed solid, the signed volume is positive if and only if every
    # face winds outward; a single inverted face makes it disagree with the
    # unsigned volume. Both are reported so the two can be compared.
    line("10. normal orientation (signed volume > 0 means every face points outward)")
    for name, obj in objects.items():
        mesh = bmesh_of(obj)
        signed = mesh.calc_volume(signed=True)
        unsigned = mesh.calc_volume(signed=False)
        line(f"   {obj.name:34s} signed volume={signed:+.6f} m^3  unsigned={unsigned:.6f} m^3  outward={signed > 0 and abs(signed - unsigned) < 1e-9}")
        mesh.free()

    # ---- bounding boxes -------------------------------------------------
    line("bounding boxes in the exported (Three.js) frame  x=width, y=up, z=front")
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3
    for name, obj in objects.items():
        mesh = bmesh_of(obj)
        xs = [v.co.x for v in mesh.verts]
        ys = [v.co.y for v in mesh.verts]
        zs = [v.co.z for v in mesh.verts]
        # blender (x, y, z) -> gltf (x, z, -y)
        gmin = (min(xs), min(zs), -max(ys))
        gmax = (max(xs), max(zs), -min(ys))
        for i in range(3):
            overall_min[i] = min(overall_min[i], gmin[i])
            overall_max[i] = max(overall_max[i], gmax[i])
        line(f"   {obj.name:34s} min=({gmin[0]:+.4f}, {gmin[1]:+.4f}, {gmin[2]:+.4f})  max=({gmax[0]:+.4f}, {gmax[1]:+.4f}, {gmax[2]:+.4f})")
        mesh.free()
    line(f"   {'OVERALL':34s} min=({overall_min[0]:+.4f}, {overall_min[1]:+.4f}, {overall_min[2]:+.4f})  max=({overall_max[0]:+.4f}, {overall_max[1]:+.4f}, {overall_max[2]:+.4f})")

    body.free()
    porch.free()
    canopy.free()
    return report


# =====================================================================
# Export — Directive 11 §3.3
# =====================================================================
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f"exported GLB: {path} ({os.path.getsize(path)} bytes)")


# =====================================================================
# Renders — Directive 11 §5.2
# =====================================================================
def setup_neutral_lighting():
    """Minimum lighting that lets the form read, independent of Three.js."""
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
    """Five viewpoints. The building's own frame is the reference; the
    compass labels follow from the Spatial Index facade bearing of 56.8 deg,
    which puts the porch side toward the ENE and the width axis roughly
    NNW-SSE."""
    setup_neutral_lighting()

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # This Blender build ships without OpenImageDenoise, so denoising is off
    # and the sample count carries the noise instead. The scene is five
    # untextured solids, so this still renders in seconds.
    scene.cycles.use_denoising = False
    scene.cycles.samples = 256
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 800
    scene.render.film_transparent = False

    camera_data = bpy.data.cameras.new("QACamera")
    camera_data.lens = 40.0
    camera = bpy.data.objects.new("QACamera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    target = Vector((0.0, 0.0, 2.2))

    views = [
        # label,                    camera position (blender frame)
        ("01_front_east", Vector((0.0, -16.0, 6.0))),
        ("02_home_west", Vector((0.0, 17.0, 6.5))),
        ("03_south", Vector((-16.0, -2.0, 6.0))),
        ("04_north", Vector((16.0, -2.0, 6.0))),
        ("05_overview", Vector((-13.0, -13.0, 14.0))),
    ]

    os.makedirs(outdir, exist_ok=True)
    written = []
    for label, position in views:
        camera.location = position
        direction = target - position
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"{label}.png")
        bpy.ops.render.render(write_still=True)
        written.append(scene.render.filepath)
        print("rendered:", scene.render.filepath)
    return written


# =====================================================================
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_station.py")
    parser.add_argument("--out", default=None, help="GLB output path")
    parser.add_argument("--render", action="store_true", help="also render the §5.2 views")
    parser.add_argument("--renderdir", default=None, help="directory for the rendered views")
    args = parser.parse_args(argv)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    out_path = args.out or os.path.join(repo_root, OUTPUT_RELATIVE_PATH)

    objects = build_station()
    verify(objects)
    export_glb(out_path)

    if args.render:
        render_dir = args.renderdir or os.path.join(repo_root, "build", "blender_qa")
        render_views(render_dir)


if __name__ == "__main__":
    main()
