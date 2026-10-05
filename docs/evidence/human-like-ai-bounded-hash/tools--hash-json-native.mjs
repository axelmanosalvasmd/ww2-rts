import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {types} from 'node:util';

// Parsed JSON can use native serialization on proven bounded subtrees. Other values keep the original path.
export function createBoundedNativeHasher(originalHashJSON,{chunkBytes=65536}={}) {
  if(!Number.isSafeInteger(chunkBytes)||chunkBytes<256)throw RangeError('Invalid hash chunk bound');
  return async function hashJSONBounded(value) {
    const costs=new WeakMap(),ancestors=new Set();let supported=true;
    const cost=child=>{
      if(child===null)return 4;
      if(typeof child==='string')return Math.min(chunkBytes+1,6*child.length+2);
      if(typeof child==='boolean')return 5;
      if(typeof child==='number')return Number.isFinite(child)?32:(supported=false,0);
      if(typeof child!=='object'){supported=false;return 0;}
      if(ancestors.has(child)){supported=false;return 0;}
      if(costs.has(child))return costs.get(child);
      if(types.isProxy(child)){supported=false;return 0;}
      const array=Array.isArray(child),prototype=Object.getPrototypeOf(child);
      if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null){supported=false;return 0;}
      if(Object.getOwnPropertySymbols(child).length){supported=false;return 0;}
      const hook=Object.getOwnPropertyDescriptor(child,'toJSON');
      if(hook&&(!Object.hasOwn(hook,'value')||typeof hook.value==='function')){supported=false;return 0;}
      ancestors.add(child);let size=2;
      const keys=array?Array.from({length:child.length},(_,i)=>String(i)):Object.keys(child);
      for(const key of keys){
        const descriptor=Object.getOwnPropertyDescriptor(child,key);
        if(!descriptor||!Object.hasOwn(descriptor,'value')){supported=false;break;}
        size=Math.min(chunkBytes+1,size+(array?1:6*key.length+4)+cost(descriptor.value));
        if(!supported)break;
      }
      ancestors.delete(child);costs.set(child,size);return size;
    };
    // A prototype-level conversion hook must retain the original method's call order.
    if(Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')||Object.getOwnPropertyDescriptor(Array.prototype,'toJSON'))return originalHashJSON(value);
    const rootCost=cost(value);if(!supported)return originalHashJSON(value);
    const hash=createHash('sha256');let bytes=0,parts=[],size=0,sinceYield=0;
    const flush=()=>{if(!size)return;const buffer=Buffer.from(parts.join(''),'utf8');hash.update(buffer);bytes+=buffer.length;sinceYield+=buffer.length;parts=[];size=0;};
    const add=fragment=>{
      const length=Buffer.byteLength(fragment);if(length>chunkBytes)throw Error('Proven hash chunk bound exceeded');
      if(size+length>chunkBytes)flush();parts.push(fragment);size+=length;
    };
    const visit=async child=>{
      const estimate=child!==null&&typeof child==='object'?costs.get(child):cost(child);
      if(estimate<=chunkBytes){add(JSON.stringify(child));return;}
      if(typeof child==='string'){
        add('"');for(let offset=0;offset<child.length;){let end=Math.min(child.length,offset+Math.floor((chunkBytes-2)/6));
          if(end<child.length&&/[\uD800-\uDBFF]/.test(child[end-1])&&/[\uDC00-\uDFFF]/.test(child[end]))end--;
          add(JSON.stringify(child.slice(offset,end)).slice(1,-1));offset=end;
          if(sinceYield>=2097152){await setImmediate();sinceYield=0;}
        }add('"');return;
      }
      const array=Array.isArray(child),keys=array?Array.from({length:child.length},(_,i)=>String(i)):Object.keys(child);
      add(array?'[':'{');for(let i=0;i<keys.length;i++){
        if(i)add(',');if(!array){await visit(keys[i]);add(':');}await visit(child[keys[i]]);
        if(sinceYield>=2097152){await setImmediate();sinceYield=0;}
      }add(array?']':'}');
    };
    await visit(value);flush();return{sha256:hash.digest('hex'),bytes};
  };
}
