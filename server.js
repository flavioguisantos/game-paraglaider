import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const TILE_SOURCES = {
  osm: 'https://tile.openstreetmap.org',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
};

app.get('/tiles/:source/:z/:x/:y.png', async (request, response) => {
  const { source, z, x, y } = request.params;
  const baseUrl = TILE_SOURCES[source];

  if (!baseUrl || !isTileCoordinate(z, x, y)) {
    response.sendStatus(404);
    return;
  }

  try {
    const upstream = await fetch(`${baseUrl}/${z}/${x}/${y}.png`, {
      headers: {
        'User-Agent': 'jogo-parapente-local-prototype/0.1'
      }
    });

    if (!upstream.ok) {
      response.sendStatus(upstream.status);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(buffer);
  } catch (error) {
    console.warn(`Nao foi possivel carregar tile ${source}/${z}/${x}/${y}`, error);
    response.sendStatus(502);
  }
});

app.get('/favicon.ico', (_request, response) => {
  response.sendStatus(204);
});

app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use('/vendor/three/addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Jogo Parapente rodando em http://localhost:${port}`);
});

function isTileCoordinate(z, x, y) {
  return [z, x, y].every((value) => /^\d+$/.test(value));
}
