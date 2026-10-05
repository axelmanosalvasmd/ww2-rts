import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {setImmediate} from 'node:timers/promises';

// Keep the original JSON token sequence. Encode bounded groups of tokens instead of each tiny token.
export function createBufferedHasher(jsonPieces) {
  return async function hashJSONBuffered(value) {
    const hash=createHash('sha256');let bytes=0,parts=[],characters=0,flushes=0;
    const flush=()=>{
      if(!characters)return;
      const chunk=Buffer.from(parts.join(''),'utf8');hash.update(chunk);bytes+=chunk.length;
      parts=[];characters=0;flushes++;
    };
    for(const piece of jsonPieces(value)) {
      if(typeof piece!=='string') {
        flush();for await(const chunk of createReadStream(piece.path)){hash.update(chunk);bytes+=chunk.length;}continue;
      }
      if(characters+piece.length>16384)flush();
      parts.push(piece);characters+=piece.length;
      if(characters>=16384)flush();
      if(flushes>=128){await setImmediate();flushes=0;}
    }
    flush();return {sha256:hash.digest('hex'),bytes};
  };
}
