"""Generate the route A assets with Blender (not ordinary Python).

From the experiment directory:
    blender --background --python route-a/generate.py

The output is public/a/{block,taper}.glb. Blender's glTF exporter converts
Z-up coordinates to glTF Y-up, placing each part's base at the origin.
"""

from pathlib import Path

import bpy


OUTPUT = Path(__file__).resolve().parent.parent / "public" / "a"


def export_part(kind, top_half_width):
    # Blender X east, Y north, Z up. Both horizontal extents are one at
    # ground level; the top extents are one or 0.6 respectively.
    bottom = [(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)]
    h = top_half_width
    top = [(-h, -h, 1), (h, -h, 1), (h, h, 1), (-h, h, 1)]
    # Winding points outward, including the underside.
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    mesh = bpy.data.meshes.new(kind)
    mesh.from_pydata(bottom + top, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(kind, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT / f"{kind}.glb"),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
    )


OUTPUT.mkdir(parents=True, exist_ok=True)
export_part("block", 0.5)
export_part("taper", 0.3)
