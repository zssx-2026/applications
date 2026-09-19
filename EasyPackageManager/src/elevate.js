'use strict';
const {spawnSync}=require('child_process'),path=require('path');
function isAdmin(){if(process.platform!=='win32')return process.getuid&&process.getuid()===0;try{const r=spawnSync('net',['session'],{stdio:'ignore'});return r.status===0}catch(_){return false}}
function elevate(args){
  if(process.platform!=='win32'){console.error('epmx is Windows-only');process.exit(1)}
  const nodeExe=process.execPath;
  const script=path.resolve(__dirname,'..','bin','epm.js');
  const cli=args.map(a=>a.indexOf(' ')!==-1?'"'+a+'"':a).join(' ');
  const cmd='"'+nodeExe+'" "'+script+'" '+cli;
  const ps="Start-Process -Verb RunAs -FilePath cmd.exe -ArgumentList '/k \""+cmd.replace(/'/g,"''")+"\"'";
  spawnSync('powershell.exe',['-NoProfile','-Command',ps],{stdio:'inherit'});
  process.exit(0);
}
module.exports={elevate,isAdmin};
