'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const AUTH_FILE=path.join(os.homedir(),'.epm','auth.json');
function load(){try{return JSON.parse(fs.readFileSync(AUTH_FILE,'utf8'))}catch(_){return null}}
function save(d){fs.mkdirSync(path.dirname(AUTH_FILE),{recursive:true});fs.writeFileSync(AUTH_FILE,JSON.stringify(d,null,2)+'\n','utf8');try{fs.chmodSync(AUTH_FILE,0o600)}catch(_){}}
function logout(){try{fs.unlinkSync(AUTH_FILE);return true}catch(_){return false}}
function getToken(){const a=load();return (a&&a.token)||process.env.GITHUB_TOKEN||process.env.GH_TOKEN||null}
module.exports={load,save,logout,getToken,AUTH_FILE};
