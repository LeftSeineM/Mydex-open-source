import {createTunnelRelay} from './tunnel-relay.mjs';
const port=Number(process.env.PORT||18084);
const relay=createTunnelRelay({maxHosts:128,maxStreams:8});
relay.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('Mydex opaque relay listening on '+port));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>relay.close());
