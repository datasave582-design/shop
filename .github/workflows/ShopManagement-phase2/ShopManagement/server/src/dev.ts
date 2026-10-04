import path from 'path';
import { startServer } from './index';

startServer({
  dataDir: path.resolve(process.env.SHOP_DATA_DIR || './dev-data'),
  clientDir: path.resolve('client/dist'),
  port: Number(process.env.SHOP_PORT) || 3000,
}).then(s => console.log(`Server chal raha hai: http://127.0.0.1:${s.port}  (data: ${s.dataDir})`));
