import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadUser, seedPermissions } from './auth.js';
import { api } from './api.js';

seedPermissions();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(loadUser);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));

const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erreur serveur' : err.message });
});

const port = Number(process.env.API_PORT || process.env.PORT || 3000);
app.listen(port, () => console.log(`Atelier — API prête sur http://localhost:${port}`));
