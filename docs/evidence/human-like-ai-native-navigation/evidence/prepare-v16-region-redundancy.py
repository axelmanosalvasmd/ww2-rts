from pathlib import Path
import shutil,difflib,hashlib,json
src=Path('/tmp/human-ai-perf-v16-frozen');dst=Path('/tmp/v16-region-redundancy-candidate');assert not dst.exists();shutil.copytree(src,dst,symlinks=True);dst.chmod(0o755);(dst/'shared').chmod(0o755);p=dst/'shared/sim.js';p.chmod(0o644);old=p.read_text();s=old
s=s.replace('const observedPaths = new WeakMap();','const observedPaths = new WeakMap();\n// Internal views have complete typed terrain and maintain every navigation version.\nconst nativeObservedPathViews = new WeakSet();')
needle='    for (let c = 0; c < N; c++) view.cellHp[c] = maxHp(view, c);';assert s.count(needle)==1
s=s.replace(needle,'    if (Number.isInteger(g.w) && Number.isInteger(g.h) && g.w > 0 && g.h > 0\n      && view.flags.length === N && view.height.length === N) nativeObservedPathViews.add(view);\n'+needle)
needle='  if (isGroundVehicle(groundProfile) && !g.vehicleFootprintKnown) return findPath(vehicleNavigationView(g, groundProfile, blockOf(groundProfile)), from, to);';assert s.count(needle)==1
s=s.replace(needle,'''  if (isGroundVehicle(groundProfile) && !g.vehicleFootprintKnown) {
    const view = vehicleNavigationView(g, groundProfile, blockOf(groundProfile));
    if (nativeObservedPathViews.has(g)) nativeObservedPathViews.add(view);
    return findPath(view, from, to);
  }''')
needle='  if (!g.worldKnown && goal !== start && !(g.flags[start] & block)) {';assert s.count(needle)==1
s=s.replace(needle,'''  // A connected coarse route is contained in full-map connectivity on these internal views.
  if (!g.worldKnown && !nativeObservedPathViews.has(g) && goal !== start && !(g.flags[start] & block)) {''')
p.write_text(s)
patch=''.join(difflib.unified_diff(old.splitlines(True),s.splitlines(True),fromfile='a/shared/sim.js',tofile='b/shared/sim.js'));Path('/tmp/v16-region-redundancy.patch').write_text(patch)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();base={str(p.relative_to(src)):sha(p) for p in src.rglob('*') if p.is_file() and 'node_modules' not in p.parts};changed={f:{'before':h,'after':sha(dst/f)} for f,h in base.items() if h!=sha(dst/f)};assert list(changed)==['shared/sim.js']
Path('/tmp/v16-region-redundancy-source-manifest.json').write_text(json.dumps({'baseline':str(src),'candidate':str(dst),'filesChecked':len(base),'changed':changed,'patchSHA256':sha(Path('/tmp/v16-region-redundancy.patch'))},indent=2));print(patch)
