from pathlib import Path
import shutil,difflib
src=Path('/tmp/human-ai-perf-v16-frozen');dst=Path('/tmp/ai-v16-fresh-root');shutil.copytree(src,dst,symlinks=True)
(dst/'shared').chmod(0o755)
(dst/'shared/ai-perception.js').chmod(0o644)
p=dst/'shared/ai-perception.js';old=p.read_text()
helper='''// The root was just built by object spread here and has not been exposed. Nested
// values still use descriptor checks and the original-root native fallback.
function copyFreshRoot(value) {
  try {
    const result = {}, seen = new Map([[value, result]]);
    for (const key of Object.keys(value)) {
      const item = copyData(value[key], seen);
      if (key === '__proto__') Object.defineProperty(result, key, { value: item, writable: true, enumerable: true, configurable: true });
      else result[key] = item;
    }
    return result;
  } catch { return structuredClone(value); }
}
'''
needle='function copyFreshData(value, seen) {'
new=old.replace(needle,helper+needle).replace('const seen = { ...clone(u), firstStillAt','const seen = { ...copyFreshRoot(u), firstStillAt')
assert new!=old
Path('/tmp/ai-v16-fresh-root.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/shared/ai-perception.js',tofile='b/shared/ai-perception.js')))
p.write_text(new+'\nexport { copyFreshRoot };\n')
