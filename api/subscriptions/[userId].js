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

  const { userId } = req.query;

  const db = initFirebase();

  if (!db) {
    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    const subscription = userDoc.data().subscription || { active: false };
    res.json({ success: true, subscription });
  } catch (error) {
    console.error('❌ subscription status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}