// Isolated, temporary public demo. Does not touch the existing RTS listener.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const port=process.env.PORT || '3100';
const runtime=process.env.FPS_RUNTIME || '/home/axel/.hermes/ww2-fps-mvp-runtime.json';
let game=null, url=null, shutting=false;
const tunnel=spawn(process.env.CLOUDFLARED || '/home/axel/.local/bin/cloudflared',['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${port}`],{stdio:['ignore','pipe','pipe']});
function log(data){
 const value=data.toString(); process.stdout.write(value);
 const found=value.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
 if(found&&!game){
  url=found[0];
  game=spawn(process.execPath,['server.js'],{cwd:root,stdio:'inherit',env:{...process.env,PORT:port,HOST:'127.0.0.1',PUBLIC_URL:url,MAX_ROOMS:'4',EDIT_PASSWORD:randomBytes(32).toString('hex')}});
  writeFileSync(runtime,JSON.stringify({url,port,host:'127.0.0.1',root,supervisorPid:process.pid,serverPid:game.pid,tunnelPid:tunnel.pid,temporary:true},null,2)+'\n',{mode:0o600});
  console.log('FPS MVP PUBLIC URL '+url);
  game.on('exit',()=>{if(!shutting){console.error('Game exited. Restart this launcher.');shutdown(1);}});
  game.on('error',e=>{console.error(e);shutdown(1);});
 }
}
tunnel.stdout.on('data',log);tunnel.stderr.on('data',log);
tunnel.on('exit',()=>{if(!shutting){console.error('Tunnel exited. Restart launcher for a new URL.');shutdown(1);}});
tunnel.on('error',e=>{console.error(e);shutdown(1);});
function shutdown(code=0){if(shutting)return;shutting=true;game?.kill('SIGTERM');tunnel.kill('SIGTERM');setTimeout(()=>process.exit(code),500);}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
