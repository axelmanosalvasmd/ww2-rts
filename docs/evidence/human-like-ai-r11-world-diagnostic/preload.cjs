const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
const originalRandomBytes = crypto.randomBytes;
const originalLog = console.log;
const started = process.hrtime.bigint();
function record(kind, extra = {}) {
  process.stderr.write(JSON.stringify({ diagnostic: kind, elapsedSeconds: Number(process.hrtime.bigint() - started) / 1e9, cpu: process.cpuUsage(), memory: process.memoryUsage(), ...extra }) + '\n');
}
crypto.randomBytes = function(...args) {
  const result = Reflect.apply(originalRandomBytes, this, args);
  if (args[0] === 4 && Buffer.isBuffer(result)) record('randomBytes4', { seed: result.readUInt32LE(), stack: new Error().stack });
  return result;
};
syncBuiltinESMExports();
console.log = function(...args) {
  record('nativeConsole', { text: args.map(String).join(' ') });
  return Reflect.apply(originalLog, this, args);
};
record('preloadStart');
process.once('exit', code => record('exit', { code }));
