import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use('/vendor/three/addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Jogo Parapente rodando em http://localhost:${port}`);
});
