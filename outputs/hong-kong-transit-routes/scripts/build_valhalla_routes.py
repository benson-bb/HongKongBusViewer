import csv, json, math, os, statistics, sys, threading, time
from concurrent.futures import ThreadPoolExecutor

PROJECT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.environ.get('PYVALHALLA_PATH'):
    sys.path.insert(0, os.environ['PYVALHALLA_PATH'])
from valhalla import Actor

FEED=os.path.join(PROJECT,'data','gtfs')
CONFIG=os.path.abspath(os.environ.get('VALHALLA_CONFIG',os.path.join(PROJECT,'valhalla','valhalla.json')))
FALLBACK=os.path.join(PROJECT,'data','route-data-roads.json')
OUTPUT=os.path.abspath(os.environ.get('VALHALLA_OUTPUT',os.path.join(PROJECT,'data','route-data-valhalla.json')))
SKIP={'FERRY','PTRAM','TRAM'}

def decode_polyline(s, precision):
    i=0; lat=lon=0; out=[]; scale=10**precision
    while i<len(s):
        for which in range(2):
            shift=result=0
            while True:
                b=ord(s[i])-63;i+=1;result|=(b&31)<<shift;shift+=5
                if b<32:break
            delta=~(result>>1) if result&1 else result>>1
            if which==0:lat+=delta
            else:lon+=delta
        out.append([lon/scale,lat/scale])
    return out

def encode_polyline(points):
    py=px=0; chars=[]
    def enc(v):
        v=~(v<<1) if v<0 else v<<1
        while v>=32:chars.append(chr((32|(v&31))+63));v>>=5
        chars.append(chr(v+63))
    for x,y in points:
        yy=round(y*1e5);xx=round(x*1e5);enc(yy-py);enc(xx-px);py=yy;px=xx
    return ''.join(chars)

def simplify(points,tol=.00016):
    if len(points)<3:return points
    sq=tol*tol;keep={0,len(points)-1};stack=[(0,len(points)-1)]
    def d2(p,a,b):
        x,y=a;dx=b[0]-x;dy=b[1]-y
        if dx or dy:
            t=max(0,min(1,((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy)));x+=dx*t;y+=dy*t
        return (p[0]-x)**2+(p[1]-y)**2
    while stack:
        a,b=stack.pop();best=sq;idx=-1
        for j in range(a+1,b):
            d=d2(points[j],points[a],points[b])
            if d>best:best=d;idx=j
        if idx>=0:keep.add(idx);stack.extend(((a,idx),(idx,b)))
    return [[round(points[i][0],5),round(points[i][1],5)] for i in sorted(keep)]

routes={r['route_id']:r for r in csv.DictReader(open(FEED+'/routes.txt',encoding='utf-8-sig'))}
stops={r['stop_id']:[float(r['stop_lon']),float(r['stop_lat'])] for r in csv.DictReader(open(FEED+'/stops.txt',encoding='utf-8-sig'))}
chosen={};seen=set();route_order=[]
for r in csv.DictReader(open(FEED+'/trips.txt',encoding='utf-8-sig')):
    route,trip=r['route_id'],r['trip_id'];parts=trip.split('-');direction=parts[1] if len(parts)>2 else '0';key=(route,direction)
    if key not in seen:seen.add(key);chosen[trip]={'route':route,'direction':direction,'points':[]};route_order.append(trip)
for r in csv.DictReader(open(FEED+'/stop_times.txt',encoding='utf-8-sig')):
    t=chosen.get(r['trip_id'])
    if t and r['stop_id'] in stops:t['points'].append(stops[r['stop_id']])

fallback_json=json.load(open(FALLBACK,encoding='utf-8'));fallback={r['i']:[decode_polyline(e,5) for e in r['e']] for r in fallback_json};fallback_idx={}
local=threading.local();lock=threading.Lock();done=0;started=time.time()
def actor():
    if not hasattr(local,'actor'):local.actor=Actor(CONFIG)
    return local.actor
def work(item):
    global done
    trip,t,idx=item;route=t['route'];meta=routes[route];pts=t['points']
    fb=(fallback.get(route) or [pts])[min(idx,len(fallback.get(route) or [pts])-1)]
    status='skip' if meta['agency_id'] in SKIP else 'ok';shape=pts if status=='skip' else None;error=''
    if status=='ok' and len(pts)>=2:
        try:
            shape=[]
            chunks=[pts[i:min(i+45,len(pts))] for i in range(0,len(pts)-1,44)]
            for chunk in chunks:
                req={'locations':[{'lat':p[1],'lon':p[0],'radius':120} for p in chunk],'costing':'bus','directions_type':'none'}
                try:res=actor().route(req)
                except Exception:
                    req['costing']='auto';res=actor().route(req)
                for leg in res.get('trip',{}).get('legs',[]):
                    q=decode_polyline(leg['shape'],6)
                    if shape and q:q=q[1:]
                    shape.extend(q)
            if len(shape)<2:raise RuntimeError('empty shape')
        except Exception as exc:status='fallback';shape=fb;error=str(exc)[:160]
    elif len(pts)<2:status='fallback';shape=fb;error='too few stops'
    shape=simplify(shape)
    with lock:
        done+=1
        if done%100==0:print(f'{done}/{len(chosen)} elapsed={time.time()-started:.1f}s',flush=True)
    return route,meta,status,encode_polyline(shape),len(pts),len(shape),error

tasks=[]
for trip in route_order:
    route=chosen[trip]['route'];idx=fallback_idx.get(route,0);fallback_idx[route]=idx+1;tasks.append((trip,chosen[trip],idx))
with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(work,tasks))
grouped={};stats={'ok':0,'fallback':0,'skip':0}
for route,meta,status,enc,nstops,nshape,error in results:
    stats[status]+=1
    grouped.setdefault(route,{'i':route,'a':meta['agency_id'],'s':meta['route_short_name'],'n':meta['route_long_name'],'e':[]})['e'].append(enc)
json.dump(list(grouped.values()),open(OUTPUT,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(json.dumps({'routes':len(grouped),'patterns':len(results),'stats':stats,'bytes':os.path.getsize(OUTPUT),'seconds':round(time.time()-started,1)}),flush=True)
