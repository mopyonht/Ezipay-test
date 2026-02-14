import fs from 'fs';
import path from 'path';
import { initFirebase } from '../_utils.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const matchesPath = path.join(process.cwd(), 'matches.json');
    const matchesData = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    const now = new Date();
    
    const finishedMatches = matchesData.matches
      .filter(match => new Date(match.datetime) < now)
      .map(match => ({
        id: match.id,
        team1: match.team1,
        team2: match.team2,
        league: match.league,
        country: match.country,
        datetime: match.datetime,
        hasResult: match.result ? true : false
      }))
      .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    
    res.json({ success: true, matches: finishedMatches });
  } catch (error) {
    console.error('❌ get-finished-matches error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}