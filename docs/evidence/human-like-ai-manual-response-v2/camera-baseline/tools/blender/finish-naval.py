"""Finish raw naval geometry in a new scene and write a synchronous game payload."""
import base64
import gzip
import os
import json
import math
import struct
import time
from pathlib import Path
import bpy


def pack(values, kind='f32', item_size=1):
    code = 'f' if kind == 'f32' else 'H' if kind == 'u16' else 'I'
    return {'type': kind, 'itemSize': item_size, 'data': base64.b64encode(struct.pack('<' + code * len(values), *values)).decode('ascii')}


def finish_part(spec, name, scene, settings):
    attrs = spec['attributes']
    positions = attrs['position']['array']
    colors = attrs['color']['array']
    owners = attrs['ownerTint']['array']
    vehicles = attrs['vehicleTint']['array']
    materials = attrs.get('matId', {'array': [-2] * len(owners)})['array']
    # Weld shading splits only when paint, masks and material class also match.
    ids, vertices, fixed, owner, vehicle, mat, remap = {}, [], [], [], [], [], []
    for i in range(len(owners)):
        point = positions[i * 3:i * 3 + 3]
        rgb = colors[i * 3:i * 3 + 3]
        material = math.floor(materials[i] + 0.25)
        key = tuple(round(v, 6) for v in point) + tuple(rgb) + (owners[i], vehicles[i], material)
        if key not in ids:
            ids[key] = len(vertices)
            vertices.append((point[0], -point[2], point[1]))
            fixed.append(rgb)
            owner.append(owners[i]); vehicle.append(vehicles[i]); mat.append(material)
        remap.append(ids[key])
    triangles = [tuple(remap[i] for i in spec['index'][at:at + 3]) for at in range(0, len(spec['index']), 3)]
    if any(len(set(t)) < 3 for t in triangles): raise ValueError(name + ': input degenerate triangle')
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], triangles)
    mesh.update()
    colors_layer = mesh.color_attributes.new(name='FixedColor', type='FLOAT_COLOR', domain='POINT')
    for i, rgb in enumerate(fixed): colors_layer.data[i].color = (*rgb, 1)
    for attribute_name, values in [('ownerTint', owner), ('vehicleTint', vehicle)]:
        layer = mesh.attributes.new(attribute_name, type='FLOAT', domain='POINT')
        layer.data.foreach_set('value', values)
    material_ids = sorted(set(mat))
    material_slots = {}
    for index, material in enumerate(material_ids):
        material_slots[material] = index
        surface = bpy.data.materials.new(f'{name}_surface_{material}')
        mesh.materials.append(surface)
    # Integer source face slots survive bevels. Never interpolate material tags.
    for face, triangle in zip(mesh.polygons, triangles):
        votes = [mat[i] for i in triangle]
        face.material_index = material_slots[max(set(votes), key=votes.count)]
        face.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    # Thin connected fixtures and unpainted/gunmetal components keep their exact mesh.
    neighbours = [set() for _ in vertices]
    for edge in mesh.edges:
        a, b = edge.vertices; neighbours[a].add(b); neighbours[b].add(a)
    visited, eligible = set(), set()
    for vertex in range(len(vertices)):
        if vertex in visited: continue
        component, pending = [], [vertex]; visited.add(vertex)
        while pending:
            at = pending.pop(); component.append(at)
            for adjacent in neighbours[at]:
                if adjacent not in visited: visited.add(adjacent); pending.append(adjacent)
        span = [max(vertices[i][axis] for i in component) - min(vertices[i][axis] for i in component) for axis in range(3)]
        if min(span) > settings['width'] * 6 and all(mat[i] in settings['material_ids'] for i in component): eligible.update(component)
    adjacent_faces = [[] for _ in mesh.edges]
    edge_lookup = {tuple(sorted(edge.vertices)): edge.index for edge in mesh.edges}
    for face in mesh.polygons:
        for key in face.edge_keys: adjacent_faces[edge_lookup[tuple(sorted(key))]].append(face)
    crease = math.radians(settings['crease_degrees'])
    for edge, faces in zip(mesh.edges, adjacent_faces):
        edge.use_edge_sharp = len(faces) != 2 or faces[0].normal.angle(faces[1].normal) >= crease
    if eligible:
        group = obj.vertex_groups.new(name='FinishBroadSurfaces')
        group.add(sorted(eligible), 1.0, 'REPLACE')
        bevel = obj.modifiers.new('Authored edge bevel', 'BEVEL')
        bevel.width = settings['width']; bevel.segments = settings['segments']
        bevel.limit_method = 'VGROUP'; bevel.vertex_group = group.name
        # Weight group alone has no angle filter, so use only endpoints of qualifying edges.
        candidate_edges = [edge for edge, faces in zip(mesh.edges, adjacent_faces)
                           if len(faces) == 2 and faces[0].normal.angle(faces[1].normal) >= math.radians(settings['bevel_degrees'])
                           and all(i in eligible for i in edge.vertices)]
        mesh.attributes.new('bevel_weight_edge', type='FLOAT', domain='EDGE')
        weights = mesh.attributes['bevel_weight_edge']
        for edge in candidate_edges: weights.data[edge.index].value = 1
        bevel.limit_method = 'WEIGHT'; bevel.edge_weight = 'bevel_weight_edge'
        bevel.use_clamp_overlap = True; bevel.harden_normals = True
        bevel.mark_sharp = True; bevel.face_strength_mode = 'FSTR_AFFECTED'
    normals = obj.modifiers.new('Authored weighted normals', 'WEIGHTED_NORMAL')
    normals.keep_sharp = True; normals.weight = 50; normals.mode = 'FACE_AREA_WITH_ANGLE'
    normals.use_face_influence = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    mesh = obj.data
    mesh.calc_loop_triangles()
    exported = {key: [] for key in ['position', 'normal', 'color', 'matId', 'ownerTint', 'vehicleTint']}
    indices, unique, degenerates = [], {}, 0
    color_data = mesh.color_attributes['FixedColor']
    for triangle in mesh.loop_triangles:
        face = mesh.polygons[triangle.polygon_index]
        material = material_ids[face.material_index]
        points = [mesh.vertices[i].co for i in triangle.vertices]
        triangle_cross = (points[1] - points[0]).cross(points[2] - points[0])
        if triangle_cross.length_squared <= 1e-15:
            degenerates += 1; continue
        triangle_normal = triangle_cross.normalized()
        for loop_index in triangle.loops:
            loop = mesh.loops[loop_index]; vertex = loop.vertex_index
            p = mesh.vertices[vertex].co; n = mesh.corner_normals[loop_index].vector.normalized()
            if n.length_squared < 1e-16 or n.dot(triangle_normal) < 0: n = triangle_normal.copy()
            if n.length_squared < 1e-16: raise ValueError('Undefined finished corner normal')
            rgb = list(color_data.data[vertex if color_data.domain == 'POINT' else loop_index].color)[:3]
            o = mesh.attributes['ownerTint'].data[vertex].value
            v = mesh.attributes['vehicleTint'].data[vertex].value
            if not all(math.isfinite(x) for x in (*p, *n, *rgb, o, v)): raise ValueError('Non-finite finished attributes')
            if min(o, v) < -1e-5 or max(o, v) > 1.00001 or o + v > 1.00001: raise ValueError('Invalid tint masks')
            o, v = max(0, min(1, o)), max(0, min(1, v))
            record = [p.x, p.z, -p.y, n.x, n.z, -n.y, *rgb, float(material), o, v]
            key = tuple(record)
            if key not in unique:
                unique[key] = len(unique)
                exported['position'].extend(record[:3]); exported['normal'].extend(record[3:6])
                exported['color'].extend(record[6:9]); exported['matId'].append(record[9])
                exported['ownerTint'].append(o); exported['vehicleTint'].append(v)
            indices.append(unique[key])
    attributes = {key: pack(values, item_size=3 if key in ['position', 'normal', 'color'] else 1) for key, values in exported.items()}
    before = len(spec['index']) // 3
    info = {'object': obj.name, 'input_triangles': before, 'output_triangles': len(indices) // 3,
            'vertices': len(unique), 'eligible_vertices': len(eligible), 'beveled_edges': len(candidate_edges) if eligible else 0,
            'dropped_degenerate_triangles': degenerates, 'material_ids': material_ids, 'index_type': 'u16' if len(unique) < 65536 else 'u32'}
    return {'attributes': attributes, 'index': pack(indices, kind='u16' if len(unique) < 65536 else 'u32')}, info


def write_module(payload, output):
    # Deduplicate exact typed arrays across faction variants without assuming shared topology.
    arrays, ids = [], {}
    def ref(spec):
        key = json.dumps(spec, sort_keys=True, separators=(',', ':'))
        if key not in ids: ids[key] = len(arrays); arrays.append(spec)
        return f'a[{ids[key]}]'
    records = []
    for key, model in payload['models'].items():
        fields = []
        for part in ['hull', 'turret']:
            if part not in model: continue
            g = model[part]
            attrs = ','.join(json.dumps(k) + ':' + ref(v) for k, v in g['attributes'].items())
            fields.append(json.dumps(part) + ':{attributes:{' + attrs + '},index:' + ref(g['index']) + '}')
        fields.extend(json.dumps(k) + ':' + json.dumps(model[k], separators=(',', ':')) for k in ['mounts', 'tip'])
        records.append(json.dumps(key) + ':{' + ','.join(fields) + '}')
    text = '// Generated by tools/blender/finish-naval.py. Rebuild from the recorded source and settings.\n'
    raw_arrays = json.dumps(arrays, separators=(',', ':')).encode()
    compressed_arrays = gzip.compress(raw_arrays, compresslevel=9, mtime=0)
    adapter = Path(__file__).resolve().parents[2] / 'client/models/blender-baked.js'
    relative_adapter = os.path.relpath(adapter, output.parent).replace(os.sep, '/')
    if not relative_adapter.startswith('.'): relative_adapter = './' + relative_adapter
    text += 'import { inflateModelArrays } from ' + json.dumps(relative_adapter) + ';\n'
    text += 'const a=await inflateModelArrays(' + json.dumps(base64.b64encode(compressed_arrays).decode('ascii')) + ');\n'
    text += 'export default {format:' + json.dumps(payload['format']) + ',source:' + json.dumps(payload['source'], separators=(',', ':')) + ',models:{' + ','.join(records) + '}};\n'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text)
    return {'bytes': output.stat().st_size, 'unique_arrays': len(arrays), 'array_references': sum(len(p['attributes']) + 1 for m in payload['models'].values() for p in [m.get('hull'), m.get('turret')] if p), 'uncompressed_array_bytes': len(raw_arrays), 'gzip_array_bytes': len(compressed_arrays)}


def main(source_path, output_path, settings):
    source = json.loads(Path(source_path).read_text())
    if source['format'] != 'ww2-blender-naval-source-v1': raise ValueError('Unsupported source schema')
    timestamp = time.strftime('%Y%m%d-%H%M%S')
    scene = bpy.data.scenes.new('WW2_RTS_FINISH_' + timestamp)
    bpy.context.window.scene = scene
    payload = {'format': 'ww2-blender-naval-v1', 'source': dict(source['source'], blenderVersion=bpy.app.version_string, settings=settings), 'models': {}}
    stats = {}
    for key, model in source['models'].items():
        finished = {'mounts': model['mounts'], 'tip': model['tip']}
        stats[key] = {}
        for part in ['hull', 'turret']:
            if part in model: finished[part], stats[key][part] = finish_part(model[part], key.replace('|', '_') + '_' + part, scene, settings)
        payload['models'][key] = finished
    output = Path(output_path)
    module = write_module(payload, output)
    report = {'scene': scene.name, 'output': str(output), 'source': payload['source'], 'models': stats, 'module': module}
    report_path = Path(source_path).parent / (output.stem + '.report.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(report_path.with_suffix('.blend')))
    return report


if __name__ == '__main__':
    result = main(finish_source, finish_output, finish_settings)
