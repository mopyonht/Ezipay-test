import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Note: Sur Vercel, vous devrez placer matches.json dans /public ou l'importer directement
    // Pour l'instant, on suppose qu'il est à la racine
    const matchesPath = path.join(process.cwd(), 'matches.json');
    const data = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    res.json(data);
  } catch (error) {
    console.error('❌ matches error:', error);
    res.status(500).json({ error: 'Erreur lors du chargement des matchs' });
  }
}