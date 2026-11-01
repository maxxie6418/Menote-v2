// 通过 Chrome DevTools Protocol 取得元素几何：Node 原生 WebSocket (Node 22 有全局 WebSocket)
const http=require('http');
const get=(p)=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9222,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));
(async()=>{
  const tabs=await get('/json/list');
  const page=tabs.find(t=>t.type==='page'&&t.url.includes('design.html'));
  if(!page){console.error('未找到 design.html 标签页');process.exit(1);}
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable');
  const expr=`(()=>{const d=document;const sec=d.querySelector('#s12');const r=sec.getBoundingClientRect();
    const demos=[...d.querySelectorAll('.sb-demo')].map(e=>{const b=e.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y+window.scrollY),w:Math.round(b.width),h:Math.round(b.height),cls:e.className};});
    return JSON.stringify({secTop:Math.round(r.top+window.scrollY),secH:Math.round(r.height),demos,docH:d.documentElement.scrollHeight});})()`;
  const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
  console.log(r.result.value);
  ws.close();process.exit(0);
})();
