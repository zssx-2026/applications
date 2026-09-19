'use strict';
const path=require('path'),config=require('./config'),versionLib=require('./version'),{readJson}=require('./utils');
const URL_FILE=path.join(config.ROOT,'url.json');
function loadUrls(){return readJson(URL_FILE,{})||{}}
function listPackages(){
  const urls=loadUrls(),releases=urls.releases||[],map=new Map();
  for(const rel of releases){
    const nt=rel.nameTxt;if(!nt||!nt.entries)continue;
    for(const e of nt.entries){
      if(!map.has(e.name))map.set(e.name,{name:e.name,type:e.type,company:e.company,versions:[]});
      const pkg=map.get(e.name);
      const a=(rel.assets||[]).find(x=>x.name===e.fileName);
      pkg.versions.push({version:e.version,tag:rel.tag,fileName:e.fileName,type:e.type,company:e.company,url:a?a.url:null,size:a?a.size:0,assetType:a?a.type:'unknown',publishedAt:rel.publishedAt,htmlUrl:rel.htmlUrl,repo:rel.repo||null});
    }
  }
  for(const pkg of map.values()){pkg.versions.sort((a,b)=>versionLib.compareVer(a.version,b.version));pkg.latest=pkg.versions[pkg.versions.length-1]}
  return Array.from(map.values()).sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
function find(name){if(!name)return null;for(const p of listPackages())if(p.name===name)return p;for(const p of listPackages())if(p.name.toLowerCase()===String(name).toLowerCase())return p;return null}
function stats(){const urls=loadUrls(),releases=urls.releases||[],pkgs=listPackages();let fc=0;for(const r of releases)fc+=(r.assets||[]).length;return{releaseCount:releases.length,pkgCount:pkgs.length,fileCount:fc,updatedAt:urls.updatedAt||null}}
function search(o){
  o=o||{};
  const text=(o.text||'').toLowerCase(),type=o.type||null,company=o.company||null,exclC=o.excludeCompanies||[],version=o.version||null,exclV=o.excludeVersions||[],fullWord=o.fullWord,allVersions=o.allVersions;
  const out=[];
  for(const pkg of listPackages()){
    if(type&&pkg.type!==type)continue;
    if(company&&pkg.company.toLowerCase().indexOf(company.toLowerCase())===-1)continue;
    if(exclC.length){let ex=false;for(const c of exclC){if(pkg.company.toLowerCase()===c.toLowerCase()){ex=true;break}}if(ex)continue}
    if(text){const m=fullWord?pkg.name.toLowerCase()===text:pkg.name.toLowerCase().indexOf(text)!==-1;if(!m)continue}
    let mv=pkg.versions.slice();
    if(version)mv=mv.filter(v=>v.version===version);
    if(exclV.length)mv=mv.filter(v=>exclV.indexOf(v.version)===-1);
    if(!mv.length)continue;
    out.push(Object.assign({},pkg,{versions:allVersions?mv:[mv[mv.length-1]],latest:mv[mv.length-1]}));
  }
  return out;
}
module.exports={loadUrls,listPackages,find,stats,search,URL_FILE};
