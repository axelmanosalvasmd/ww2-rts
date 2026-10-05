// Node-only evidence storage. Report values retain native JSON serialization semantics.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { types } from 'node:util';
import { setImmediate } from 'node:timers/promises';

class RawJSONFile { constructor(path) { this.path = path; } }
export const rawJSONFile = path => new RawJSONFile(path);
const supported = value => !['undefined', 'function', 'symbol'].includes(typeof value);
function prepare(value, key) {
  if (value !== null && ['object', 'function', 'bigint'].includes(typeof value)) {
    const toJSON = value.toJSON; if (typeof toJSON === 'function') value = toJSON.call(value, key);
  }
  if (types.isNumberObject(value)) value = Number(value);
  else if (types.isStringObject(value)) value = String(value);
  else if (types.isBooleanObject(value)) value = Boolean.prototype.valueOf.call(value);
  else if (types.isBigIntObject(value)) value = BigInt.prototype.valueOf.call(value);
  return value;
}
function* quoted(value) {
  yield '"';
  // Keep surrogate pairs together at boundaries, including native well-formed lone-surrogate escapes.
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + 8192);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    yield JSON.stringify(value.slice(offset, end)).slice(1, -1); offset = end;
  }
  yield '"';
}
export function* jsonPieces(input, space = 0) {
  const indent = typeof space === 'number' ? ' '.repeat(Math.min(10, Math.max(0, Math.trunc(space)))) : String(space || '').slice(0, 10);
  const ancestors = new Set();
  function* visit(value, depth) {
    if (value instanceof RawJSONFile) { yield value; return; }
    if (typeof value === 'string') { yield* quoted(value); return; }
    if (value === null || typeof value !== 'object') {
      const encoded = JSON.stringify(value); if (encoded === undefined) throw new TypeError('Root value is not JSON serializable.'); yield encoded; return;
    }
    if (ancestors.has(value)) throw new TypeError('Converting circular structure to JSON');
    ancestors.add(value);
    try {
      const array = Array.isArray(value), keys = array ? null : Object.keys(value), length = array ? value.length : keys.length;
      yield array ? '[' : '{'; let count = 0;
      for (let i = 0; i < length; i++) {
        const key = array ? String(i) : keys[i], child = prepare(value[key], key);
        if (!array && !supported(child)) continue;
        if (count++) yield ',';
        if (indent) yield '\n' + indent.repeat(depth + 1);
        if (!array) { yield* quoted(key); yield indent ? ': ' : ':'; }
        yield* visit(supported(child) ? child : null, depth + 1);
      }
      if (count && indent) yield '\n' + indent.repeat(depth);
      yield array ? ']' : '}';
    } finally { ancestors.delete(value); }
  }
  const value = prepare(input, '');
  if (!supported(value)) throw new TypeError('Root value is not JSON serializable.');
  yield* visit(value, 0);
}
export async function* jsonChunks(value, { space = 0, newline = false, chunkBytes = 65536 } = {}) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4) throw new RangeError('Chunk size must be an integer of at least four bytes.');
  let buffer = Buffer.allocUnsafe(chunkBytes), used = 0, emitted = 0; const encoder = new TextEncoder();
  for (const piece of jsonPieces(value, space)) {
    if (piece instanceof RawJSONFile) {
      if (used) { yield buffer.subarray(0, used); buffer = Buffer.allocUnsafe(chunkBytes); used = 0; }
      for await (const chunk of createReadStream(piece.path, { highWaterMark: chunkBytes })) yield chunk;
      continue;
    }
    for (let offset = 0; offset < piece.length;) {
      const { read, written } = encoder.encodeInto(piece.slice(offset), buffer.subarray(used)); offset += read; used += written;
      if (used === chunkBytes || !read) {
        yield buffer.subarray(0, used); buffer = Buffer.allocUnsafe(chunkBytes); used = 0;
        // CPU-only hash consumers also need event-loop turns to release native buffers and service stream errors.
        if (++emitted % 32 === 0) await setImmediate();
      }
    }
  }
  if (newline) { buffer[used++] = 10; if (used === chunkBytes) { yield buffer; used = 0; } }
  if (used) yield buffer.subarray(0, used);
}
export async function hashJSON(value) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of jsonChunks(value)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
export async function hashFile(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
export async function temporaryOutput(path) {
  path = resolve(path); await mkdir(dirname(path), { recursive: true });
  const existing = await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing && !existing.isFile()) throw new Error(`Output must be a regular file: ${path}`);
  const directory = await mkdtemp(join(dirname(path), `.${basename(path)}-`));
  return { path: join(directory, 'content'), async commit() { await rename(this.path, path); }, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
}
export async function writeJSON(path, value, options = {}) {
  const staged = await temporaryOutput(path);
  try { await pipeline(Readable.from(jsonChunks(value, options)), createWriteStream(staged.path, { flags: 'wx' })); await staged.commit(); }
  finally { await staged.cleanup(); }
}
export async function stageGzip(input, output) {
  const staged = await temporaryOutput(output), hash = createHash('sha256'); let bytes = 0;
  try {
    await pipeline(createReadStream(input), new Transform({ transform(chunk, encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } }), createGzip({ level: 9 }), createWriteStream(staged.path, { flags: 'wx' }));
    return { staged, raw: { sha256: hash.digest('hex'), bytes }, gzip: await hashFile(staged.path) };
  } catch (error) { await staged.cleanup(); throw error; }
}

// Bound parsing to one result, rather than the campaign-sized report. Strings, UTF8 and object keys use JSON.parse unchanged.
export async function readReport(path, onResult, { gzip = false } = {}) {
  const source = createReadStream(path); let stream = source;
  if (gzip) { stream = source.pipe(createGunzip()); source.on('error', error => stream.destroy(error)); }
  stream.setEncoding('utf8'); const iterator = stream[Symbol.asyncIterator]();
  let chunk = '', index = 0, ended = false;
  async function ensure() { while (index === chunk.length && !ended) { const next = await iterator.next(); ended = next.done; chunk = ended ? '' : next.value; index = 0; } return !ended; }
  async function whitespace() { while (await ensure()) { if (!/[\x20\t\r\n]/.test(chunk[index])) return; index++; } }
  async function take(expected) { await whitespace(); if (!await ensure() || chunk[index++] !== expected) throw new SyntaxError(`Expected ${expected} in report JSON.`); }
  async function value(delimiters = ',]}') {
    await whitespace(); const parts = []; let depth = 0, quoted = false, escaped = false;
    while (await ensure()) {
      const start = index;
      for (; index < chunk.length; index++) {
        const char = chunk[index];
        if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
        if (!depth && delimiters.includes(char)) break;
        if (char === '"') quoted = true; else if (char === '[' || char === '{') depth++; else if (char === ']' || char === '}') depth--;
      }
      parts.push(chunk.slice(start, index));
      if (index < chunk.length) break;
    }
    return JSON.parse(parts.join(''));
  }
  const report = {}, results = []; let count = 0;
  try {
    await take('{'); await whitespace();
    if (await ensure() && chunk[index] === '}') index++;
    else while (true) {
      if (count++) await take(',');
      const key = await value(':'); if (typeof key !== 'string') throw new SyntaxError('Report property names must be strings.'); await take(':');
      if (key === 'results') {
        results.length = 0; await take('['); await whitespace();
        if (await ensure() && chunk[index] === ']') index++;
        else { let resultIndex = 0; while (true) { if (resultIndex) await take(','); const result = await value(); results.push(await onResult(result, resultIndex++)); await whitespace(); if (await ensure() && chunk[index] === ']') { index++; break; } } }
        Object.defineProperty(report, key, { value: results, enumerable: true, configurable: true, writable: true });
      } else Object.defineProperty(report, key, { value: await value(), enumerable: true, configurable: true, writable: true });
      await whitespace(); if (await ensure() && chunk[index] === '}') { index++; break; }
    }
    await whitespace(); if (await ensure()) throw new SyntaxError('Unexpected data after report JSON.');
    return report;
  } finally { stream.destroy(); source.destroy(); }
}
