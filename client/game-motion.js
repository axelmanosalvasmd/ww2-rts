// Additive motion lane. Reliable game snapshots remain authoritative recovery.
export const MOTION_FIELDS = [3,4,5,6,15,16,17,18];
const encoder=new TextEncoder(), decoder=new TextDecoder();
export function encodeMotion(row){const bytes=encoder.encode(JSON.stringify(row));if(bytes.length>1000)throw Error('oversize motion');return bytes;}
export function decodeMotion(bytes){if(bytes.byteLength>1000)throw Error('oversize motion');return JSON.parse(decoder.decode(bytes));}
export function validMotion(m){return Array.isArray(m)&&m.length===12&&typeof m[0]==='string'&&m[0].length<=64&&m.slice(1,4).every(n=>Number.isSafeInteger(n)&&n>=0)&&m.slice(4).every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);}
export function createMotionGate(){
 let generation=null,revision=0,tick=-1;const visible=new Set(),latest=new Map();
 return {
  baseline(meta,rows){if(!meta){this.reset();return;}if(meta.generation!==generation||meta.revision!==revision){latest.clear();visible.clear();}generation=meta.generation;revision=meta.revision;tick=meta.tick;visible.clear();for(const r of rows)visible.add(r[0]);for(const [id,m]of latest)if(!visible.has(id)||m[2]<=tick)latest.delete(id);},
  accept(m){if(!validMotion(m)||m[0]!==generation||m[1]!==revision||!visible.has(m[3])||m[2]<=tick||m[2]<=(latest.get(m[3])?.[2]??-1))return false;latest.set(m[3],m);return true;},
  overlay(rows,at=tick){for(const r of rows){const m=latest.get(r[0]);if(m&&m[2]>at)MOTION_FIELDS.forEach((f,i)=>r[f]=m[i+4]);}},
  reset(){generation=null;revision=0;tick=-1;latest.clear();visible.clear();},
 };
}
