"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";


type Employer = {id:number;name:string;sector:string|null;country:string|null};
const LOCATIONS: Record<string,[number,number]> = {
  "United States":[-98,39],"South Korea":[127.8,36.4],"Japan":[138,36.2],
  "Taiwan":[121,23.7],"China":[104,35],"Germany":[10.5,51.2],
  "United Kingdom":[-2,54],"Canada":[-106,56],"France":[2.2,46.6],
  "Italy":[12.5,42.8],"Netherlands":[5.3,52.1],"Switzerland":[8.2,46.8],
  "Sweden":[15,62],"India":[79,22],"Other":[0,0]
};
const COUNTRIES = Object.keys(LOCATIONS).filter(c=>c!=="Other");
const W=1000,H=500;
const project=([lon,lat]:[number,number]):[number,number]=>[(lon+180)/360*W,(90-lat)/180*H];
const MCKINNEY=project([-96.6153,33.1972]);
type GeoFeature = { geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null };
const GEOJSON_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
function ringPath(ring:number[][]):string {
  return ring.map((p,i)=>{const [x,y]=project([p[0],p[1]]);return (i?"L":"M")+x.toFixed(1)+","+y.toFixed(1);}).join(" ")+" Z";
}
function featurePath(feature:GeoFeature):string {
  const geometry=feature.geometry;
  if(!geometry)return "";
  const polygons:number[][][][]=geometry.type==="Polygon"
    ? [geometry.coordinates as number[][][]]
    : geometry.coordinates as number[][][][];
  return polygons.map(poly=>poly.map(ringPath).join(" ")).join(" ");
}
function arc(a:[number,number],b:[number,number]) {
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  return `M ${a[0]} ${a[1]} Q ${(a[0]+b[0])/2} ${(a[1]+b[1])/2-Math.min(100,len*.22)} ${b[0]} ${b[1]}`;
}
export function HeadquartersMap({employers}:{employers:Employer[]}) {
  const [selected,setSelected]=useState<string|null>(null);
  const [land,setLand]=useState<GeoFeature[]>([]);
  const [mapError,setMapError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(GEOJSON_URL,{signal:controller.signal})
      .then(r=>{if(!r.ok)throw new Error("Map unavailable");return r.json();})
      .then((data:{features?:GeoFeature[]})=>{
        if(!Array.isArray(data.features))throw new Error("Invalid geographic data");
        setLand(data.features.filter(f=>f.geometry?.type==="Polygon"||f.geometry?.type==="MultiPolygon"));
      })
      .catch(err=>{if(err?.name!=="AbortError")setMapError(true);});
    return ()=>controller.abort();
  },[]);
  const [search,setSearch]=useState("");
  const rows=useMemo(()=>employers.filter(e=>Boolean(e.country)&&e.country!=="United States"&&e.country!=="Other"&&Boolean(LOCATIONS[e.country!])),[employers]);
  const groups=useMemo(()=>{
    const result=new Map<string,Employer[]>();
    for(const e of rows) if(e.country && e.country!=="Other" && LOCATIONS[e.country]) {
      result.set(e.country,[...(result.get(e.country)??[]),e]);
    }
    return [...result.entries()].sort((a,b)=>b[1].length-a[1].length);
  },[rows]);
  const unverified=employers.filter(e=>!e.country||e.country==="Other").length;
  const visible=groups.filter(([country])=>!selected||selected===country);
  return <main className="wrap" style={{maxWidth:1300}}>
    <header className="head"><div><h1>Global Headquarters</h1><div className="tag">Foreign-owned employers connected to McKinney</div></div></header>
    <p style={{margin:"12px 0 20px"}}>Only foreign-parent companies are included. Dots represent <strong>approximate country locations, not actual headquarters addresses</strong>. Lines show conceptual connections to McKinney, not travel routes.</p>
    <div className="dir-summary"><strong>{rows.length}</strong> foreign-owned firms · <strong>{groups.length}</strong> countries represented</div>
    <div className="card" style={{padding:12,overflow:"hidden"}}>
      <svg viewBox="0 0 1000 500" role="img" aria-label="World map showing foreign-parent countries connected to McKinney" style={{display:"block",width:"100%",height:"auto",background:"#eaf1f3",borderRadius:8}}>
        <g fill="#c4d7d7" stroke="#9cb7bb" strokeWidth=".65" fillRule="evenodd">{land.map((feature,i)=><path key={i} d={featurePath(feature)} />)}</g>
        <g stroke="#d5e2e4" strokeWidth=".8">{[100,200,300,400,500,600,700,800,900].map(x=><path key={x} d={`M${x} 0V500`}/>)}{[100,200,300,400].map(y=><path key={y} d={`M0 ${y}H1000`}/>)}</g>
        {visible.map(([country])=>{const p=project(LOCATIONS[country]);return <path key={country} d={arc(MCKINNEY,p)} stroke="#178c9b" strokeWidth="2" strokeOpacity=".65" strokeDasharray="5 4" fill="none"/>})}
        {groups.map(([country,companies])=>{const [x,y]=project(LOCATIONS[country]);return <g key={country} role="button" tabIndex={0} aria-label={`${country}: ${companies.length} companies`} onClick={()=>setSelected(selected===country?null:country)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(selected===country?null:country)}}} style={{cursor:"pointer"}}><circle cx={x} cy={y} r={selected===country?13:10} fill={selected===country?"#e1a947":"#0e6e79"} stroke="white" strokeWidth="2"/><text x={x} y={y+4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">{companies.length}</text><title>{country}: {companies.map(e=>e.name).join(", ")}</title></g>})}
        <circle cx={MCKINNEY[0]} cy={MCKINNEY[1]} r="7" fill="#cf633d" stroke="white" strokeWidth="2"/>
        <text x={MCKINNEY[0]+12} y={MCKINNEY[1]-11} fontSize="15" fontWeight="700" fill="#23464d">McKinney</text>
      </svg>\n      {mapError&&<p role="alert">Country boundary data could not load. The company registry remains available.</p>}
      {!mapError&&land.length===0&&<p>Loading geographic boundaries…</p>}
      {groups.length===0&&<p>No verified foreign-parent companies mapped yet.</p>}
      <small style={{display:"block",marginTop:8}}>Real country outlines from Natural Earth. Country dots are approximate, not company addresses. Select a dot to filter the list.</small>
    </div>
    <section style={{margin:"20px 0"}}>
      <h2>Companies by headquarters country</h2>
      {groups.length===0?<p>No countries assigned yet. Review the registry below.</p>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
        {visible.map(([country,companies])=><div className="card" key={country} style={{padding:16}}>
          <h3 style={{margin:"0 0 8px"}}>{country} <span style={{fontWeight:400}}>({companies.length})</span></h3>
          <ul style={{paddingLeft:18,margin:0}}>{companies.map(e=><li key={e.id} style={{marginBottom:5}}><Link href={`/employer/${e.id}`}>{e.name}</Link></li>)}</ul>
        </div>)}
      </div>}
    </section>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",margin:"18px 0"}}>
      <button className="handle" type="button" onClick={()=>setSelected(null)}>All countries</button>
      {groups.map(([country,companies])=><button className="handle" type="button" key={country} onClick={()=>setSelected(selected===country?null:country)} style={{fontWeight:selected===country?800:400}}>{country} ({companies.length})</button>)}
    </div>
    <div className="card" style={{padding:16}}>
      <h2 style={{marginTop:0}}>Foreign-owned companies</h2>
      <p>Companies shown have researched foreign parent-company origins. U.S.-headquartered firms and unverified records are excluded.</p>
      <input className="paste-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search companies…" aria-label="Search companies" style={{width:"100%",marginBottom:12}}/>
      <div style={{maxHeight:520,overflowY:"auto"}}>
        {rows.filter(e=>(!selected||e.country===selected)&&(`${e.name} ${e.country??""}`.toLowerCase().includes(search.toLowerCase()))).map(e=><div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #e3e9ea",flexWrap:"wrap"}}>
          <div style={{flex:"1 1 220px"}}><Link href={`/employer/${e.id}`} style={{fontWeight:600}}>{e.name}</Link><div style={{fontSize:12,opacity:.75}}>{e.sector??"Sector not listed"}</div></div>
          <strong>{e.country}</strong>
        </div>)}
      </div>
    </div>
  </main>;
}
