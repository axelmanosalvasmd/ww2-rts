# Textured infantry

The near infantry body comes from the generated `infantry-realism-v3.png` reference,
processed locally in Image to 3D Lab and fitted in Blender 5.2.2. The retained input
is `art/model-reference-2026-10-03/infantry-retopo-v3.glb`. Its 5,984 triangles preserve
the face, cloth folds, boots, pockets and straps. The broken direct 8k reduction was
rejected. It is not a runtime asset.

The accepted reduction first made a closed surface with a 0.0018 voxel remesh,
then reduced it toward 6,000 faces and baked the source color and normal detail.
The color atlas is 2,048 square; the normal atlas is 1,024 square. The original
high-resolution local run is `ww2-infantry-realism-20261003-v3` in Image to 3D Lab.
The PNG sidecar records the reference generation request and returned model.
Account and request identifiers are omitted from the shared sidecars.
`infantry-provenance-v3.json` retains the backend parameters, license metadata,
source hashes and reduction settings alongside the mesh.

`rig-infantry.py` welds UV-seam duplicates without discarding corner UVs, creates a
15-bone Blender armature, solves bone-heat weights and constrains anatomically
incorrect influences. It writes the normalized weights back to the editable
`.blend` file and exports the same skin to `infantry-authored-data.js`. The source
hash travels with that payload. The game fits the skin to the existing aiming,
running, crouching, prone and fallen poses. Closed weapon grips replace the open
reference hands. Muzzle positions and gameplay reach remain unchanged.

Run `bash tools/blender/rebuild-infantry.sh` while the project Blender connection
is running, then `node test-infantry-authored.mjs`. The rebuild creates a new scene
and preserves other scenes. Its compressed `.blend` contains only this character
and its dependencies.

All four factions currently share this base uniform cut and face. Their colors,
helmets, weapons and specialist equipment differ. This is not four independently
modeled historical uniforms. Alternate helmets use a closed scalp beneath the
retained face. The distant procedural figures remain small; near figures keep
the existing batching, pose transitions and owner rings. Low graphics retains
the essential color atlas and omits its normal-map sampling.

Review both the Blender source and the actual game viewer. Example:
`/client/viewer.html?type=rifle&fac=1&view=8&grid=0&ground=3b3d39`.
Check every faction, a specialist, crouching, prone and running before accepting
a rebuild. Numeric geometry checks cannot establish visual quality.
