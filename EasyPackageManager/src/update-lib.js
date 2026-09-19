'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),http=require('http');
const config=require('./config'),names=require('./names'),classify=require('./classify'),auth=require('./auth');
const URL_FILE=path.join(config.ROOT,'url.json'),SETTINGS_FILE=path.join(config.ROOT,'settings.json');
const MAX_PAGES=100,PER_PAGE=100;
function readJson(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(_){return d}}
function writeJson(f,d){fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n','utf8')}
function getNet(){const s=readJson(SETTINGS_FILE,{}),n=s.network||{};return{retries:n.retries==null?4:n.retries,retryDelayMs:n.retryDelayMs==null?800:n.retryDelayMs,timeoutMs:n.timeoutMs==null?30000:n.timeoutMs}}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function requestOnce(url,t){
  return new Promise((res,rej)=>{
    let u;try{u=new URL(url)}catch(e){return rej(new Error('bad url'))}
    const h={'user-agent':'EasyPackageManager/1.0.0','accept':'application/vnd.github+json','x-github-api-version':'2022-11-28','accept-encoding':'identity','connection':'close'};
    const token=auth.getToken();if(token)h.authorization='Bearer '+token;
    const lib=u.protocol==='http:'?http:https;
    const req=lib.request({protocol:u.protocol,hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,method:'GET',headers:h},r=>{const c=[];r.on('data',x=>c.push(x));r.on('end',()=>res({status:r.statusCode,headers:r.headers,body:Buffer.concat(c)}));r.on('error',rej)});
    req.on('error',rej);req.setTimeout(t,()=>req.destroy(new Error('Timeout')));req.end();
  });
}
async function retry(url,redirect){
  if(redirect===undefined)redirect=0;
  const net=getNet();let lastErr=null;
  for(let i=0;i<=net.retries;i++){
    try{
      const r=await requestOnce(url,net.timeoutMs);
      if([301,302,303,307,308].indexOf(r.status)>=0&&r.headers.location){if(redirect>6)throw new Error('too many redirects');return await retry(new URL(r.headers.location,url).toString(),redirect+1)}
      if(r.status>=500){lastErr=new Error('HTTP '+r.status);if(i<net.retries){await sleep(net.retryDelayMs*Math.pow(2,i));continue}throw lastErr}
      return r;
    }catch(e){lastErr=e;if(i<net.retries){await sleep(net.retryDelayMs*Math.pow(2,i));continue}throw e}
  }
  throw lastErr||new Error('failed');
}
function normalize(r,repo){
  const tag=r.tag_name||r.name||'unknown';
  return{id:r.id,tag,name:r.name||tag,repo:repo||null,prerelease:!!r.prerelease,draft:!!r.draft,publishedAt:r.published_at,createdAt:r.created_at,htmlUrl:r.html_url,assets:(r.assets||[]).map(a=>({id:a.id,name:a.name,size:a.size,contentType:a.content_type,downloadCount:a.download_count,createdAt:a.created_at,updatedAt:a.updated_at,type:classify.classify(a.name),url:a.browser_download_url}))};
}
function nextLink(h){const l=h&&(h.link||h.Link);if(!l)return null;for(const p of String(l).split(',')){const m=p.match(/<([^>]+)>\s*;\s*rel="next"/);if(m)return m[1]}return null}
async function fetchRepo(owner,repo){
  const all=[],seen=new Set();
  let url='https://api.github.com/repos/'+owner+'/'+repo+'/releases?per_page='+PER_PAGE+'&page=1',page=1;
  while(url&&page<=MAX_PAGES){
    const r=await retry(url);
    if(r.status===404)return[];
    if(r.status===403||r.status===429)throw new Error('rate limited');
    if(r.status>=400)throw new Error('HTTP '+r.status);
    let batch;try{batch=JSON.parse(r.body.toString('utf8'))}catch(e){break}
    if(!Array.isArray(batch)||!batch.length)break;
    for(const x of batch){const k=String(x.id);if(seen.has(k))continue;seen.add(k);all.push(normalize(x,owner+'/'+repo))}
    const n=nextLink(r.headers);if(!n)break;url=n;page++;
  }
  return all;
}
async function fetchNameTxt(rel){
  const a=(rel.assets||[]).find(x=>/^name\.txt$/i.test(x.name));if(!a)return null;
  try{const r=await retry(a.url);if(r.status>=400)return null;const t=r.body.toString('utf8');return t&&t.trim()?t:null}catch(_){return null}
}
function isApp(rel){var s=String((rel&&rel.tag)||'')+' '+String((rel&&rel.name)||'');return /application/i.test(s)}
async function fetchAll(){
  const urlData=readJson(URL_FILE,{});
  const owner=(urlData.source&&urlData.source.owner)||'zssx-2026';
  const repos=['applications'];
  const a=auth.load();
  if(a&&a.username)repos.push(a.username+'/easypkgmgr');
  const all=[];
  for(const spec of repos){
    let o,r;
    if(spec.indexOf('/')!==-1){[o,r]=spec.split('/')}else{o=owner;r=spec}
    console.log('[epm] '+o+'/'+r+' ...');
    let rels;
    try{rels=await fetchRepo(o,r)}catch(e){console.log('[epm] '+e.message);continue}
    const vis=rels.filter(x=>!x.draft).filter(x=>isApp(x));
    console.log('[epm]   '+vis.length+' releases');
    for(const rel of vis){
      const t=await fetchNameTxt(rel);
      if(t){rel.nameTxt={raw:t,entries:names.parse(t)};console.log('[epm]   '+rel.tag+': '+rel.nameTxt.entries.length+' entries')}
      all.push(rel);
    }
  }
  const next={version:1,updatedAt:new Date().toISOString(),source:{owner,repo:'applications',api:'https://api.github.com/repos/'+owner+'/applications/releases',releases:'https://github.com/'+owner+'/applications/releases'},releases:all};
  writeJson(URL_FILE,next);
  return{releases:all,fileCount:all.length};
}
module.exports={fetchAll,fetchRepo};
