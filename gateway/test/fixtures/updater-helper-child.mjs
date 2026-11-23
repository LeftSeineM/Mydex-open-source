import fs from 'node:fs';
import {startUpdateHelper} from '../../../desktop/updater.mjs';
const [script,ready,complete]=process.argv.slice(2),q=s=>s.replaceAll("'","''");
fs.writeFileSync(script,"[IO.File]::WriteAllText('"+q(ready)+"','ready'); Start-Sleep -Seconds 3; [IO.File]::WriteAllText('"+q(complete)+"','complete')",'utf8');
await startUpdateHelper(script,ready);
