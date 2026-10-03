"""Import game meshes into a new Blender QA scene without removing existing scenes."""
import json
import math
import time
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

# MCP callers can supply review_path; Blender --python uses the default export.
source = Path(globals().get('review_path') or Path(__file__).resolve().parents[2] / '.cache/blender-mcp/model-review.json')
data = json.loads(source.read_text())
if data['schema'] != 'ww2-rts-blender-review-v1':
    raise ValueError('Unsupported review mesh schema')
stamp = time.strftime('%Y%m%d-%H%M%S')
scene = bpy.data.scenes.new('WW2_RTS_QA_' + stamp)
bpy.context.window.scene = scene
scene['qa_source'] = str(source)
scene['qa_shader_limit'] = data['shaderLimit']
axis = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
material = bpy.data.materials.new('WW2_QA_vertex_colors_' + stamp)
material.use_nodes = True
bsdf = material.node_tree.nodes.get('Principled BSDF')
color = material.node_tree.nodes.new('ShaderNodeVertexColor')
color.layer_name = 'GameColor'
material.node_tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.78
stats = []
for row, model in enumerate(data['models']):
    group = bpy.data.objects.new(f"{model['type']}_f{model['faction']}_review", None)
    scene.collection.objects.link(group)
    width = model['bounds']['max'][0] - model['bounds']['min'][0]
    scale = 20 / max(width, 0.001)
    group.scale = (scale,) * 3
    group.location = (0, (row - (len(data['models']) - 1) / 2) * 11, 0)
    model_stats = {'type': model['type'], 'faction': model['faction'], 'source_bounds': model['bounds'], 'display_scale': scale, 'meshes': []}
    for spec in model['meshes']:
        attrs = spec['attributes']
        points = attrs['position']['array']
        if len(points) % 3 or not all(math.isfinite(x) for x in points):
            raise ValueError('Invalid mesh positions')
        count = len(points) // 3
        values = spec['matrixWorld']
        world = Matrix([[values[c * 4 + r] for c in range(4)] for r in range(4)])
        normal_matrix = axis @ world.to_3x3().inverted().transposed()
        vertices = [axis @ (world @ Vector(points[i:i + 3])) for i in range(0, len(points), 3)]
        indices = spec['indices'] if spec['indices'] is not None else list(range(count))
        if len(indices) % 3 or any(i < 0 or i >= count for i in indices):
            raise ValueError('Invalid triangle indices')
        faces = [indices[i:i + 3] for i in range(0, len(indices), 3)]
        mesh = bpy.data.meshes.new(spec['name'] + '_' + stamp)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        colors = attrs.get('color', {}).get('array')
        rgba = mesh.color_attributes.new(name='GameColor', type='FLOAT_COLOR', domain='POINT')
        tint = spec['materialColor']
        for i in range(count):
            rgb = colors[i * 3:i * 3 + 3] if colors else [1, 1, 1]
            rgba.data[i].color = [rgb[k] * tint[k] for k in range(3)] + [1]
        normals = attrs.get('normal', {}).get('array')
        if normals:
            mesh.normals_split_custom_set_from_vertices([(normal_matrix @ Vector(normals[i:i + 3])).normalized() for i in range(0, len(normals), 3)])
            for face in mesh.polygons: face.use_smooth = True
        for name, attr in attrs.items():
            if name in ('position', 'normal', 'color'): continue
            size = attr['itemSize']
            for channel in range(size):
                saved = mesh.attributes.new(name=name if size == 1 else f'{name}_{channel}', type='FLOAT', domain='POINT')
                saved.data.foreach_set('value', attr['array'][channel::size])
        obj = bpy.data.objects.new(spec['name'], mesh)
        scene.collection.objects.link(obj)
        obj.parent = group
        obj.data.materials.append(material)
        obj['qa_source_mesh'] = spec['name']
        obj['qa_morph_target_counts'] = json.dumps({k: len(v) for k, v in spec['morphTargets'].items()})
        degenerate = sum((vertices[b] - vertices[a]).cross(vertices[c] - vertices[a]).length_squared < 1e-16 for a, b, c in faces)
        model_stats['meshes'].append({'object': obj.name, 'vertices': count, 'triangles': len(faces), 'degenerate_triangles': degenerate, 'attributes': list(attrs)})
    stats.append(model_stats)
    label = bpy.data.curves.new(group.name + '_label', 'FONT')
    label.body = f"{model['factionName']} {model['type']} (mesh QA)"
    label.align_x = 'CENTER'
    label.size = 0.7
    text = bpy.data.objects.new(group.name + '_label', label)
    scene.collection.objects.link(text)
    text.location = (0, group.location.y - 4.5, 0.02)

floor_mesh = bpy.data.meshes.new('WW2_QA_floor_' + stamp)
floor_mesh.from_pydata([(-22, -len(stats) * 8, -0.65), (22, -len(stats) * 8, -0.65), (22, len(stats) * 8, -0.65), (-22, len(stats) * 8, -0.65)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new('WW2_QA_floor_' + stamp, floor_mesh)
scene.collection.objects.link(floor)
floor_material = bpy.data.materials.new('WW2_QA_floor_' + stamp)
floor_material.diffuse_color = (0.22, 0.25, 0.27, 1)
floor.data.materials.append(floor_material)
camera_data = bpy.data.cameras.new('WW2_QA_camera_' + stamp)
camera = bpy.data.objects.new('WW2_QA_camera_' + stamp, camera_data)
scene.collection.objects.link(camera)
camera.location = (28, -36, 40)
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = max(38, len(stats) * 14)
scene.camera = camera
for name, at, energy, size in [('key', (5, -10, 28), 2600, 16), ('fill', (-20, 12, 20), 1900, 14)]:
    light_data = bpy.data.lights.new('WW2_QA_' + name + '_' + stamp, 'AREA')
    light_data.energy = energy
    light_data.shape = 'DISK'
    light_data.size = size
    light = bpy.data.objects.new(light_data.name, light_data)
    scene.collection.objects.link(light)
    light.location = at
    light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('WW2_QA_world_' + stamp)
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value = (0.45, 0.5, 0.6, 1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0.5
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1400
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'PNG'
output = source.parent / ('review-' + stamp)
report = {'scene': scene.name, 'source': str(source), 'models': stats, 'shader_limit': data['shaderLimit'], 'blend_file': str(output.with_suffix('.blend')), 'render_file': str(output.with_suffix('.png'))}
output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=report['blend_file'])
# Frame the viewport without changing an external scene.
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
        area.spaces.active.shading.type = 'MATERIAL'
result = report
print(json.dumps(report))
