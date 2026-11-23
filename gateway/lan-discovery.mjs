import dgram from 'node:dgram';
// Discovery contains only a public certificate fingerprint and random nonce.
// Actual access still requires pinned TLS + the gateway's Bearer credential.
export function startLanDiscovery({fingerprint,port,discoveryPort=18445}){
  const socket=dgram.createSocket({type:'udp4',reuseAddr:true}),rates=new Map();
  socket.on('error',()=>{});
  socket.on('message',(raw,remote)=>{
    if(raw.length>256)return;
    const now=Date.now(),last=rates.get(remote.address)||0;if(now-last<100)return;
    rates.set(remote.address,now);if(rates.size>256)rates.clear();
    try{const m=JSON.parse(raw);if(m.type!=='mydex.discover.v1'||m.fingerprint!==fingerprint||!/^[a-f0-9]{32}$/.test(m.nonce))return;
      socket.send(JSON.stringify({type:'mydex.discover.v1',nonce:m.nonce,port}),remote.port,remote.address);
    }catch{}
  });socket.bind(discoveryPort,'0.0.0.0');socket.unref();
  return {stop(){try{socket.close();}catch{}}};
}
