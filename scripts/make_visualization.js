const fs = require('fs');
const data = fs.readFileSync('work/route-data-roads.json','utf8');
const roads = fs.readFileSync('work/road-base.json','utf8');
const out = 'C:/Users/benso/.codex/visualizations/2026/08/24/01a032da-53c4-7780-b98d-6360c8fc0b5d/hong-kong-transit-routes.html';
const html = `<div id="hk-transit-map">
  <style>
    #hk-transit-map{color:var(--foreground);font-family:inherit;width:100%}
    #hk-transit-map .top{display:flex;gap:12px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
    #hk-transit-map h2{margin:0}
    #hk-transit-map .meta{color:var(--muted-foreground);margin-top:3px}
    #hk-transit-map .viz-controls{margin:0}
    #hk-transit-map .map-wrap{position:relative;width:100%;min-height:520px}
    #hk-transit-map svg{width:100%;height:auto;display:block}
    #hk-transit-map .road-base{fill:none;stroke:var(--border);stroke-opacity:.55;stroke-width:.55;vector-effect:non-scaling-stroke}
    #hk-transit-map .route{fill:none;stroke-opacity:.31;stroke-width:.75;vector-effect:non-scaling-stroke}
    #hk-transit-map .route.g0{stroke:var(--viz-series-1)}#hk-transit-map .route.g1{stroke:var(--viz-series-2)}#hk-transit-map .route.g2{stroke:var(--viz-series-3)}
    #hk-transit-map .route.g3{stroke:var(--viz-series-4)}#hk-transit-map .route.g4{stroke:var(--viz-series-5)}#hk-transit-map .route.g5{stroke:var(--viz-series-6)}
    #hk-transit-map .route.dim{stroke-opacity:.035}
    #hk-transit-map .route.active{stroke-opacity:.9;stroke-width:1.55}
    #hk-transit-map .route.selected{stroke:var(--foreground);stroke-opacity:1;stroke-width:3}
    #hk-transit-map .route-hit{fill:none;stroke:transparent;stroke-width:7;vector-effect:non-scaling-stroke;cursor:pointer}
    #hk-transit-map .coast-label{fill:var(--muted-foreground);font-size:11px;pointer-events:none}
    #hk-transit-map .tooltip{position:absolute;display:none;pointer-events:none;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);padding:7px 9px;border-radius:6px;max-width:260px;z-index:3}
    #hk-transit-map .detail{margin-top:8px;min-height:26px;color:var(--muted-foreground)}
    #hk-transit-map .detail strong{color:var(--foreground);font-weight:500}
    #hk-transit-map .legend{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 8px;color:var(--muted-foreground)}
    #hk-transit-map .legend span{display:inline-flex;align-items:center;gap:4px}
    #hk-transit-map .sw{width:18px;height:3px;display:inline-block}.sw.g0{background:var(--viz-series-1)}.sw.g1{background:var(--viz-series-2)}.sw.g2{background:var(--viz-series-3)}.sw.g3{background:var(--viz-series-4)}.sw.g4{background:var(--viz-series-5)}.sw.g5{background:var(--viz-series-6)}
    @media(max-width:520px){#hk-transit-map .map-wrap{min-height:390px}#hk-transit-map .top{align-items:stretch}#hk-transit-map .viz-controls{width:100%}}
  </style>
  <div class="top">
    <div><h2>香港公共交通路線</h2><div class="meta" id="hk-count">2,448 條路線 · 3,629 個方向</div></div>
    <div class="viz-controls">
      <label class="form-label">營辦商<select id="hk-agency" class="form-select"><option value="">全部</option></select></label>
      <label class="form-label">路線搜尋<input id="hk-search" class="form-control" type="search" placeholder="例如 968、機場、長洲"></label>
    </div>
  </div>
  <div class="legend text-small" aria-label="路線類別圖例"><span><i class="sw g0"></i>專營巴士</span><span><i class="sw g1"></i>小巴</span><span><i class="sw g2"></i>居民／過境巴士</span><span><i class="sw g3"></i>渡輪</span><span><i class="sw g4"></i>電車／纜車</span><span><i class="sw g5"></i>港鐵巴士</span></div>
  <div class="map-wrap"><svg role="img" aria-label="香港公共交通路線地圖"></svg><div class="tooltip" role="tooltip"></div></div>
  <div class="detail" id="hk-detail" aria-live="polite">移到路線上查看資料；按一下可固定選取。</div>
  <script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
  <script>
  (()=>{
    const root=document.getElementById('hk-transit-map'), data=${data}, roadLines=${roads};
    const names={XB:'落馬洲過境巴士',PI:'馬灣居民巴士',DB:'愉景灣居民巴士',LWB:'龍運巴士',KMB:'九龍巴士','KMB+CTB':'九巴／城巴','LWB+CTB':'龍運／城巴',CTB:'城巴',LRTFeeder:'港鐵巴士',NLB:'新大嶼山巴士',GMB:'綠色專線小巴',FERRY:'渡輪',PTRAM:'山頂纜車',TRAM:'香港電車'};
    function decode(s){let i=0,lat=0,lon=0,p=[];while(i<s.length){let b,sh=0,r=0;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32);lat+=(r&1)?~(r>>1):(r>>1);sh=0;r=0;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32);lon+=(r&1)?~(r>>1):(r>>1);p.push([lon/1e5,lat/1e5])}return p}
    data.forEach(d=>{d.p=d.e.map(decode);delete d.e}); const roadsDecoded=roadLines.map(decode);
    const svg=d3.select(root.querySelector('svg')), wrap=root.querySelector('.map-wrap'), tip=root.querySelector('.tooltip'), detail=root.querySelector('#hk-detail');
    const agency=root.querySelector('#hk-agency'), search=root.querySelector('#hk-search'), count=root.querySelector('#hk-count');
    [...new Set(data.map(d=>d.a))].sort((a,b)=>(names[a]||a).localeCompare(names[b]||b,'zh-HK')).forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=names[a]||a;agency.appendChild(o)});
    let selected=null;
    function match(d){const q=search.value.trim().toLowerCase();return (!agency.value||d.a===agency.value)&&(!q||d.s.toLowerCase().includes(q)||d.n.toLowerCase().includes(q)||(names[d.a]||d.a).toLowerCase().includes(q))}
    function label(d){return '<strong>'+escapeHtml(d.s||d.i)+'</strong> · '+escapeHtml(names[d.a]||d.a)+'<br>'+escapeHtml(d.n)}
    function escapeHtml(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
    function draw(){
      const w=Math.max(320,wrap.clientWidth), h=w<520?390:520; svg.attr('viewBox',\`0 0 \${w} \${h}\`);
      const features=[]; data.forEach(d=>d.p.forEach(p=>features.push({type:'Feature',properties:{r:d},geometry:{type:'LineString',coordinates:p}})));
      const roadFeatures=roadsDecoded.map(p=>({type:'Feature',geometry:{type:'LineString',coordinates:p}}));
      const fc={type:'FeatureCollection',features}, projection=d3.geoMercator().fitExtent([[14,14],[w-14,h-14]],fc), path=d3.geoPath(projection);
      svg.selectAll('*').remove();
      const g=svg.append('g'), hasFilter=!!(agency.value||search.value.trim());
      g.selectAll('path.road-base').data(roadFeatures).join('path').attr('class','road-base').attr('d',path);
      function group(a){if(a==='GMB')return 1;if(['PI','DB','XB'].includes(a))return 2;if(a==='FERRY')return 3;if(['TRAM','PTRAM'].includes(a))return 4;if(a==='LRTFeeder')return 5;return 0}
      g.selectAll('path.route').data(features).join('path').attr('class',d=>'route g'+group(d.properties.r.a)).attr('d',path).classed('dim',d=>hasFilter&&!match(d.properties.r)).classed('active',d=>hasFilter&&match(d.properties.r)).classed('selected',d=>selected===d.properties.r);
      g.selectAll('path.route-hit').data(features).join('path').attr('class','route-hit').attr('d',path)
        .on('pointerenter',(e,d)=>{tip.style.display='block';tip.innerHTML=label(d.properties.r)})
        .on('pointermove',e=>{const r=wrap.getBoundingClientRect();tip.style.left=Math.min(e.clientX-r.left+12,r.width-270)+'px';tip.style.top=(e.clientY-r.top+12)+'px'})
        .on('pointerleave',()=>tip.style.display='none')
        .on('click',(e,d)=>{selected=selected===d.properties.r?null:d.properties.r;detail.innerHTML=selected?label(selected):'移到路線上查看資料；按一下可固定選取。';draw()});
      const active=data.filter(match).length;count.textContent=active.toLocaleString('zh-HK')+' / '+data.length.toLocaleString('zh-HK')+' 條路線 · '+features.length.toLocaleString('zh-HK')+' 個方向';
    }
    let timer; function update(){clearTimeout(timer);timer=setTimeout(draw,80)} agency.addEventListener('change',draw);search.addEventListener('input',update);new ResizeObserver(update).observe(wrap);draw();
  })();
  </script>
</div>`;
fs.writeFileSync(out,html);
console.log(JSON.stringify({out,bytes:fs.statSync(out).size}));
