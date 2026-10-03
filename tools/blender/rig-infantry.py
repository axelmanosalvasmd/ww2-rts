"""Fit a textured A-pose infantry mesh to the game's pose rig and export its skin.

Run inside Blender with infantry_source, infantry_output and infantry_blend paths set.
The source is a separate reduced copy. Its original high-resolution mesh is preserved.
"""
import base64
import gzip
import hashlib
import json
import math
from array import array
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector


def v(value):
    return Vector(value)


def frame(a, b, up=(1, 0, 0)):
    x = (v(b) - v(a)).normalized()
    y = v(up) - x * v(up).dot(x)
    if y.length < 1e-6:
        y = v((0, 0, 1)) - x * x.z
    y.normalize()
    z = x.cross(y).normalized()
    return Matrix(((x.x, y.x, z.x, a[0]), (x.y, y.y, z.y, a[1]),
                   (x.z, y.z, z.z, a[2]), (0, 0, 0, 1)))


def clamp(x, a=0, b=1):
    return max(a, min(b, x))


def smooth(x):
    t = clamp(x)
    return t * t * (3 - 2 * t)


def main():
    source = Path(infantry_source)
    destination = Path(infantry_output)
    scene = bpy.data.scenes.new('WW2 Infantry V3 Authoring')
    bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=str(source))
    objects = [o for o in scene.objects if o.type == 'MESH']
    if len(objects) != 1:
        raise ValueError('Expected one reduced, atlas-textured mesh')
    obj = objects[0]
    obj.name = 'Infantry_Authored_Body'
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mesh = obj.data
    low = min(p.co.z for p in mesh.vertices)
    high = max(p.co.z for p in mesh.vertices)
    scale = 1.40 / (high - low)
    # The source faces Blender +Y. The game uses +X forward and +Y up.
    center_x = (min(p.co.x for p in mesh.vertices) + max(p.co.x for p in mesh.vertices)) / 2
    mid = [p.co.y for p in mesh.vertices if low + (high-low)*0.43 < p.co.z < low + (high-low)*0.58]
    center_y = (min(mid) + max(mid)) / 2
    for p in mesh.vertices:
        p.co = v(((p.co.x - center_x)*scale, (p.co.y-center_y)*scale, (p.co.z-low)*scale))
    obj.location = (0, 0, 0)
    mesh.update()

    # glTF duplicates vertices at UV seams. Weld positions while retaining per-loop UVs
    # so Blender's heat solver receives one connected, closed character surface.
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
    bm.to_mesh(mesh); bm.free(); mesh.update()

    rest = []
    names = []
    segments = []
    def bone(name, a, b, up=(1, 0, 0)):
        names.append(name); segments.append((a,b)); rest.append(frame(a,b,up)); return len(rest)-1
    pelvis = bone('pelvis', (0,.70,0), (0,.88,0))
    chest = bone('chest', (0,.88,0), (0,1.15,0))
    head = bone('head', (.085,1.27,.008), (.085,1.37,.008))
    sides = []
    for side, suffix in [(-1,'L'),(1,'R')]:
        hip=(-.025,.70,side*.10)
        knee=(-.122,.36,-.117) if side<0 else (-.052,.36,.151)
        ankle=(-.145,.062,-.145) if side<0 else (-.09,.062,.175)
        shoulder=(-.036,1.10,-.155) if side<0 else (.035,1.10,.173)
        elbow=(-.037,.90,-.260) if side<0 else (.051,.90,.249)
        wrist=(-.059,.72,-.344) if side<0 else (.081,.72,.331)
        sides.append({
            'thigh':bone('thigh.'+suffix,hip,knee),
            'shin':bone('shin.'+suffix,knee,ankle),
            'foot':bone('foot.'+suffix,ankle,(ankle[0]+.13,.062,ankle[2]),(0,1,0)),
            'upper':bone('upper_arm.'+suffix,shoulder,elbow),
            'fore':bone('forearm.'+suffix,elbow,wrist),
            'hand':bone('hand.'+suffix,wrist,(-.053,.61,-.380) if side<0 else (.11,.61,.360)),
        })

    def arm_boundary(y):
        delta = max(0, 1.10-y)
        return min(.285, .12 + min(delta, .2)*.3 + max(0, delta-.2)*.7)

    def weights(p):
        x,y,z=p; side=sides[0 if z<0 else 1]
        if y>1.16:
            h=smooth((y-1.16)/.055)
            return [(head,h),(chest,1-h)]
        # The empty gap under each arm separates sleeves from the jacket.
        boundary=arm_boundary(y)
        if y>.58 and abs(z)>boundary:
            e=smooth((.975-y)/.12)
            h=smooth((.75-y)/.055)
            arm=smooth((abs(z)-boundary)/.055) if y>1.02 else 1.0
            return [(side['upper'],(1-e)*(1-h)*arm),(side['fore'],e*(1-h)*arm),(side['hand'],h*arm),(chest,1-arm)]
        if y<.71:
            if y<.14:
                f=1-smooth((y-.075)/.065)
                return [(side['foot'],f),(side['shin'],1-f)]
            k=1-smooth((y-.31)/.13)
            h=smooth((y-.61)/.10)
            return [(side['thigh'],(1-k)*(1-h)),(side['shin'],k*(1-h)),(pelvis,h)]
        c=smooth((y-.78)/.28)
        return [(pelvis,1-c),(chest,c)]

    # Native Blender armature and vertex groups remain editable in the saved source.
    conversion=Matrix(((0,0,-1,0),(1,0,0,0),(0,1,0,0),(0,0,0,1)))
    arm_data=bpy.data.armatures.new('Infantry_Game_Rig')
    arm=bpy.data.objects.new('Infantry_Game_Rig',arm_data)
    scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True)
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(a,b) in zip(names,segments):
        edit=arm_data.edit_bones.new(name)
        edit.head=conversion @ v(a)
        edit.tail=conversion @ v(b)
    for i, name in enumerate(names):
        edit = arm_data.edit_bones[name]
        if i == 1: edit.parent = arm_data.edit_bones[names[0]]
        elif i == 2: edit.parent = arm_data.edit_bones[names[1]]
        elif i >= 3:
            offset = (i-3) % 6
            parent = 0 if offset == 0 else 1 if offset == 3 else i-1
            edit.parent = arm_data.edit_bones[names[parent]]
    bpy.ops.object.mode_set(mode='OBJECT')
    # Blender's bone heat solver follows the connected surface, including folds and kit.
    # Simple spatial bands incorrectly pulled belt pouches along with the sleeves.
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    index_by_group = {obj.vertex_groups[name].index:i for i,name in enumerate(names)}
    binds=[]
    unweighted=0
    for vertex in mesh.vertices:
        x,y,z = vertex.co.y,vertex.co.z,-vertex.co.x
        arm_mask = smooth((abs(z) - arm_boundary(y) + .025)/.05)
        def influence(index):
            if index < 3:
                return 1.0
            limb = (index-3)//6
            part = (index-3)%6
            side = -1 if limb == 0 else 1
            same_side = smooth((z*side+.035)/.07)
            if part < 3:
                return same_side * (1-smooth((y-.63)/.18)) * (1-arm_mask)
            hand = smooth((.83-y)/.12) * smooth((abs(z)-.25)/.08) if part == 5 else 1.0
            return same_side * arm_mask * hand
        ws=sorted(((index_by_group[g.group],g.weight*influence(index_by_group[g.group])) for g in vertex.groups
                   if g.group in index_by_group and g.weight*influence(index_by_group[g.group]) > 1e-6), key=lambda pair:-pair[1])[:4]
        if not ws or sum(w for _, w in ws) < .05 or (y > .78 and arm_mask < .1):
            unweighted += 1
            ws = weights((vertex.co.y,vertex.co.z,-vertex.co.x))
        total=sum(w for _,w in ws)
        binds.append([(i,w/total) for i,w in ws])
    print(json.dumps({'boneHeatUnweightedVertices':unweighted}))
    # Persist the same normalized, four-influence skin exported to the game.
    for group in obj.vertex_groups: group.remove(list(range(len(mesh.vertices))))
    for vertex, ws in zip(mesh.vertices, binds):
        for index, weight in ws: obj.vertex_groups[names[index]].add([vertex.index], weight, 'REPLACE')
    arm.show_in_front=True

    mesh.calc_loop_triangles()
    uv=mesh.uv_layers.active.data
    material=mesh.materials[0]
    shader=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    color_image=shader.inputs['Base Color'].links[0].from_node.image
    pixels=array('f',[0])*len(color_image.pixels)
    color_image.pixels.foreach_get(pixels)
    width,height=color_image.size
    indices=[]; attrs={'position':[],'normal':[],'uv':[],'joints':[],'weights':[],'fabric':[],'skin':[]}
    keys={}
    for triangle in mesh.loop_triangles:
        for li in triangle.loops:
            loop=mesh.loops[li]; vertex=mesh.vertices[loop.vertex_index]
            p=(vertex.co.y,vertex.co.z,-vertex.co.x)
            normal=mesh.corner_normals[li].vector
            normal=v((normal.y,normal.z,-normal.x))
            tex=(uv[li].uv.x,1-uv[li].uv.y)
            ix=int(clamp(uv[li].uv.x)*(width-1)); iy=int(clamp(uv[li].uv.y)*(height-1))
            red,green,blue=pixels[(iy*width+ix)*4:(iy*width+ix)*4+3]
            fabric=1.0 if .12<p[1]<1.18 and red<green*1.15 and blue>green*.72 else 0.0
            ws=binds[loop.vertex_index]
            joint=[i for i,w in ws]+[0]*(4-len(ws))
            weight=[w for i,w in ws]+[0]*(4-len(ws))
            key=tuple(p)+tuple(normal)+tex+tuple(joint)+tuple(weight)
            if key not in keys:
                keys[key]=len(keys)
                for name,values in [('position',p),('normal',normal),('uv',tex),('joints',joint),('weights',weight)]:attrs[name].extend(values)
                attrs['fabric'].append(fabric)
                attrs['skin'].append(1 if red > green*1.13 and red > blue*1.25 else 0)
            indices.append(keys[key])
    # Mapping Blender +Y forward to game +X changes handedness. Keep outward winding.
    for i in range(0, len(indices), 3):
        indices[i+1], indices[i+2] = indices[i+2], indices[i+1]
    data={'format':'ww2-infantry-skin-v1','sourceHash':hashlib.sha256(source.read_bytes()).hexdigest(),
          'blender':bpy.app.version_string,'bones':names,'lengths':[(v(b)-v(a)).length for a,b in segments],
          'rest':[list(m.transposed()[r][c] for r in range(4) for c in range(4)) for m in rest],
          'attributes':attrs,'indices':indices}
    destination.parent.mkdir(parents=True,exist_ok=True)
    encoded=base64.b64encode(gzip.compress(json.dumps(data,separators=(',',':')).encode(),mtime=0)).decode()
    destination.write_text("// Blender-authored textured infantry and fitted game skin. Rebuild with tools/blender/rig-infantry.py.\nimport { inflateModelArrays } from './blender-baked.js';\nexport default await inflateModelArrays('"+encoded+"');\n")
    # Pack the source texture images so the editable file has no external dependencies.
    for image in bpy.data.images:
        if image.type=='IMAGE' and image.has_data:
            try:image.pack()
            except RuntimeError:pass
    bpy.data.libraries.write(infantry_blend, {scene}, fake_user=True, compress=True)
    print(json.dumps({'output':str(destination),'vertices':len(keys),'triangles':len(indices)//3,
                      'bones':len(names),'blend':infantry_blend}))


main()
