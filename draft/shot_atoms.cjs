const http=require('http'),fs=require('fs');
const port=process.argv[2],out=process.argv[3];
const get=(p)=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port:port,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));
(async()=>{
  const tabs=await get('/json/list');
  const page=tabs.find(t=>t.type==='page'&&t.url.includes('atomic.html'));
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable');await send('Runtime.enable');
  await new Promise(r=>setTimeout(r,1600));
  const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});
    if(r.exceptionDetails)return null;return r.result&&r.result.value;};
  // 取 Atoms 段最后两张卡（滚动条 + 瀑布流）的并集
  const b=await ev(`(()=>{
    const names=[...document.querySelectorAll('.card-h .name')];
    const s=names.find(n=>n.textContent.includes('scrollbar')).closest('.card');
    const g=names.find(n=>n.textContent.includes('gallery')).closest('.card');
    const r1=s.getBoundingClientRect(),r2=g.getBoundingClientRect();
    const x=Math.min(r1.x,r2.x),y=Math.min(r1.y,r2.y);
    return {x:Math.round(x),y:Math.round(y+scrollY),width:Math.round(r1.width),height:Math.round(r2.bottom-r1.top)};})()`);
  if(!b){console.error('未找到原子卡');process.exit(1);}
  console.log('box',JSON.stringify(b));
  const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:b.x,y:b.y,width:b.width,height:b.height,scale:2},captureBeyondViewport:true,fromSurface:true});
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
  console.log('saved',out);
  ws.close();process.exit(0);
})();
