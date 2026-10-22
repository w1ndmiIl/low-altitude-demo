"""从已下载的 OSM 官方 XML 生成离线浏览器数据，不需要第三方库。"""
import json, math, hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'data/qianjiang.osm'
xml = ET.parse(source).getroot()
origin = (120.244, 30.239)
sx = 111320 * math.cos(math.radians(origin[1]))
def project(lon, lat):
    return [round((lon-origin[0])*sx, 2), round(-(lat-origin[1])*110540, 2)]
nodes = {n.attrib['id']: n for n in xml.findall('node')}
def tags(e): return {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}
def num(value):
    try: return float(str(value).split(';')[0].replace('m','').strip())
    except (ValueError, TypeError): return None

buildings, roads, waters, signals = [], [], [], []
for way in xml.findall('way'):
    ts = tags(way)
    refs = [n.attrib['ref'] for n in way.findall('nd')]
    if any(ref not in nodes for ref in refs): continue
    points = [project(float(nodes[r].attrib['lon']), float(nodes[r].attrib['lat'])) for r in refs]
    if len(points)<2: continue
    if ts.get('building') and len(points)>=4:
        h = num(ts.get('height')); provenance = 'OSM height'
        if not h:
            levels = num(ts.get('building:levels'))
            if levels: h, provenance = levels*3.3, 'levels x assumed 3.3 m'
            else:
                category=ts.get('building')
                h = {'apartments':72,'residential':42,'commercial':105,'office':120,'industrial':14,'transportation':8,'retail':18,'hotel':90}.get(category,30)
                provenance = 'simulation default by building category'
        buildings.append({'id':int(way.attrib['id']),'name':ts.get('name',''),'kind':ts.get('building'),'points':points,'height':round(h,1),'heightSource':provenance})
    if ts.get('highway'):
        lanes=num(ts.get('lanes')) or (2 if ts.get('oneway')=='yes' else 4)
        width=num(ts.get('width')) or max(4,min(24,lanes*3.3))
        category=ts['highway']
        if category in ['footway','path','cycleway','pedestrian','steps']:width=2.5
        roads.append({'id':int(way.attrib['id']),'name':ts.get('name',''),'kind':category,'points':points,'nodes':refs,'width':round(width,1),'oneway':ts.get('oneway')=='yes','reverse':ts.get('oneway')=='-1','tunnel':ts.get('tunnel')=='yes','bridge':ts.get('bridge')=='yes','layer':num(ts.get('layer')) or 0,'maxspeed':num(ts.get('maxspeed')) or 40})
    if ts.get('natural')=='water' and len(points)>=4:waters.append({'id':int(way.attrib['id']),'name':ts.get('name',''),'points':points})
for node in nodes.values():
    if tags(node).get('highway')=='traffic_signals': signals.append({'id':node.attrib['id'],'point':project(float(node.attrib['lon']),float(node.attrib['lat']))})
north_source=ROOT/'data/qianjiang-north.osm'
north_count=0
if north_source.exists():
    north=ET.parse(north_source).getroot()
    nn={n.attrib['id']:n for n in north.findall('node')}
    candidates=[];road_ids={r['id'] for r in roads};building_ids={b['id'] for b in buildings};signal_ids={s['id'] for s in signals}
    key_names={'新业路','富春路','钱江路','解放东路','之江路','城星路','市民街','新塘路','清江路','秋涛路'}
    for way in north.findall('way'):
        ts=tags(way);refs=[n.attrib['ref'] for n in way.findall('nd')]
        if any(ref not in nn for ref in refs):continue
        points=[project(float(nn[r].attrib['lon']),float(nn[r].attrib['lat'])) for r in refs]
        if len(points)<2:continue
        wid=int(way.attrib['id'])
        if ts.get('building') and len(points)>=4 and wid not in building_ids:
            h=num(ts.get('height'));prov='OSM height'
            if not h:
                levels=num(ts.get('building:levels'));h=levels*3.3 if levels else {'apartments':66,'commercial':105,'office':120}.get(ts.get('building'),30);prov='levels x assumed 3.3 m' if levels else 'simulation default by building category'
            cx=sum(p[0] for p in points)/len(points);cz=sum(p[1] for p in points)/len(points)
            candidates.append((math.hypot(cx+3100,cz+1050),{'id':wid,'name':ts.get('name',''),'kind':ts['building'],'points':points,'height':round(h,1),'heightSource':prov,'bank':'north-sampled'}))
        category=ts.get('highway')
        if wid not in road_ids and category and (ts.get('name') in key_names or category in ['primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','trunk','trunk_link']):
            lanes=num(ts.get('lanes')) or (2 if ts.get('oneway')=='yes' else 4);width=num(ts.get('width')) or max(4,min(24,lanes*3.3))
            roads.append({'id':wid,'name':ts.get('name',''),'kind':category,'points':points,'nodes':refs,'width':round(width,1),'oneway':ts.get('oneway')=='yes','reverse':ts.get('oneway')=='-1','tunnel':ts.get('tunnel')=='yes','bridge':ts.get('bridge')=='yes','layer':num(ts.get('layer')) or 0,'maxspeed':num(ts.get('maxspeed')) or 40,'bank':'north-key-roads'});road_ids.add(wid)
    for _,b in sorted(candidates,key=lambda item:item[0])[:40]:buildings.append(b);north_count+=1
    for node in nn.values():
        if tags(node).get('highway')=='traffic_signals' and node.attrib['id'] not in signal_ids:signals.append({'id':node.attrib['id'],'point':project(float(node.attrib['lon']),float(node.attrib['lat']))})
river_source=ROOT/'data/qiantang-water.osm'
if river_source.exists():
    river=ET.parse(river_source).getroot()
    rn={n.attrib['id']:project(float(n.attrib['lon']),float(n.attrib['lat'])) for n in river.findall('node')}
    rw={w.attrib['id']:[n.attrib['ref'] for n in w.findall('nd')] for w in river.findall('way')}
    relation=next(q for q in river.findall('relation') if q.attrib['id']=='8227206')
    def rings(role):
        remaining=[rw[m.attrib['ref']] for m in relation.findall('member') if m.attrib.get('role')==role and m.attrib['type']=='way']
        result=[]
        while remaining:
            chain=remaining.pop()
            changed=True
            while chain[0]!=chain[-1] and changed:
                changed=False
                for i,w in enumerate(remaining):
                    if w[0]==chain[-1]:chain+=w[1:]
                    elif w[-1]==chain[-1]:chain+=list(reversed(w))[1:]
                    elif w[-1]==chain[0]:chain=w[:-1]+chain
                    elif w[0]==chain[0]:chain=list(reversed(w))[:-1]+chain
                    else:continue
                    remaining.pop(i);changed=True;break
            if len(chain)>3:result.append([rn[n] for n in chain])
        return result
    def clip(points):
        polygon=points
        for axis,bound,greater in [(0,-4800,True),(0,4200,False),(1,-4500,True),(1,2400,False)]:
            output=[]
            for i,p in enumerate(polygon):
                q=polygon[i-1];inside_p=(p[axis]>=bound if greater else p[axis]<=bound);inside_q=(q[axis]>=bound if greater else q[axis]<=bound)
                if inside_p!=inside_q:
                    fraction=(bound-q[axis])/(p[axis]-q[axis]);output.append([round(q[0]+fraction*(p[0]-q[0]),2),round(q[1]+fraction*(p[1]-q[1]),2)])
                if inside_p:output.append(p)
            polygon=output
            if not polygon:break
        return polygon
    for index,ring in enumerate(rings('outer')):
        clipped=clip(ring)
        if len(clipped)>=3:waters.append({'id':8227206,'name':'钱塘江','source':'OSM multipolygon relation 8227206','points':clipped})
data={'source':'OpenStreetMap official API','sourceUrl':'https://api.openstreetmap.org/api/0.6/map?bbox=120.230,30.225,120.268,30.267','license':'ODbL 1.0','attribution':'© OpenStreetMap contributors','origin':origin,'projection':'local equirectangular metres, x east / z south','queryBounds':[120.230,30.225,120.268,30.267],'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'buildings':buildings,'roads':roads,'waters':waters,'signals':signals,'assumptions':'Missing heights use category defaults or levels × 3.3m. Tunnel depth, traffic signal phases, vehicle demand and flight restrictions are simulation parameters. Source construction tags are not interpreted as current closure.'}
data['northBuildingCount']=north_count
data['northSourceUrl']='https://api.openstreetmap.org/api/0.6/map?bbox=120.197,30.243,120.224,30.267'
data['northSourceSha256']=hashlib.sha256(north_source.read_bytes()).hexdigest() if north_source.exists() else None
out=ROOT/'demo/geo-data.js'
out.write_text('(function(r){const data='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';if(typeof module==="object"&&module.exports)module.exports=data;else r.LowAirGeoData=data;})(globalThis);\n',encoding='utf-8')
known=sum(b['heightSource']=='OSM height' for b in buildings)
summary={'buildings':len(buildings),'roads':len(roads),'tunnelRoadRecords':sum(r['tunnel'] for r in roads),'buildingHeightsFromOSM':known,'buildingHeightsEstimated':len(buildings)-known,'waters':len(waters),'signals':len(signals),'sourceSha256':data['sourceSha256']}
summary['southBuildings']=len(buildings)-north_count;summary['northBuildingsSampled']=north_count
(ROOT/'data/source-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
