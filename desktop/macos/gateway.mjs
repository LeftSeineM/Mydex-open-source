import fs from 'node:fs';
import {createGateway} from '../../gateway/server.mjs';
import {migrateCodexExecutable} from '../setup.mjs';

// The legacy Windows server's direct-entry URL check is platform-specific.
// Use its exported server here, without changing existing Windows deployments.
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
migrateCodexExecutable(process.argv[2],config);
const {server,refresh}=createGateway(config);
server.listen(config.port,config.host,()=>{void refresh();});
