const http=require('http'),fs=require('fs');
const get=(p)=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9225,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));
(async()=>{
  const tabs=await get('/json/list');
  const page=tabs.find(t=>t.type==='page'&&t.url.includes('design.html'));
  if(!page){console.error('未找到标签页');process.exit(1);}
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0;const pend=new Map();
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable');
  await new Promise(r=>setTimeout(r,2500));
  const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)return 'EXC: '+JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);
    return r.result&&r.result.value;};
  console.log('readyState:', await ev('document.readyState'));
  console.log('s12 exists:', await ev('!!document.querySelector("#s11")'));
  const geo=await ev(`(()=>{const e=document.querySelector('#s11');if(!e)return null;const r=e.getBoundingClientRect();
    return JSON.stringify({top:Math.round(r.top+scrollY),h:Math.round(r.height),docH:document.documentElement.scrollHeight,
    demos:[...document.querySelectorAll('.sb-demo')].map(x=>{const b=x.getBoundingClientRect();return [Math.round(b.x),Math.round(b.top+scrollY),Math.round(b.width),Math.round(b.height)].join(',')})});})()`);
  console.log('geo:', geo);
  // 截 #s11 元素
  const box=await ev(`(()=>{const e=document.querySelector('#s11');const r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+scrollX),y:Math.round(r.y+scrollY),width:Math.round(r.width),height:Math.round(r.height)});})()`);
  if(box&&box.startsWith('{')){
    const b=JSON.parse(box);
    const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:b.x,y:b.y,width:b.width,height:b.height,scale:1},captureBeyondViewport:true});
    fs.writeFileSync('draft/sb-section.png',Buffer.from(shot.data,'base64'));
    console.log('已保存 draft/sb-section.png');
  }
  ws.close();process.exit(0);
})();
