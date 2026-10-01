// Frees GPU memory for scene parts that get rebuilt: the terrain structures after a dig or a shell, and the whole
// world when Play again starts a new match in the same page. three keeps a geometry's buffers, and the instance
// buffers of an InstancedMesh, until dispose() is called on them.
// Materials and textures are left alone: they are shared caches (surfaces.js, markers.js, the ground paint).
// keep: geometries shared with live objects (the GEO set in main.js). Disposing one of those would only cost a
// re-upload, but there is no reason to churn them.
export function disposeTree(root, keep = new Set()) {
  const geos = new Set();
  root.traverse((o) => {
    if (o.isSprite) return; // sprites share one quad geometry inside three
    o.dispose?.();
    if (o.geometry && !keep.has(o.geometry)) geos.add(o.geometry);
  });
  for (const g of geos) g.dispose();
}
