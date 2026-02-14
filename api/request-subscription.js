import admin from 'firebase-admin';
import { initFirebase } from './_utils.js';

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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, amount, paymentMethod } = req.body;

  const db = initFirebase();

  if (!db) {
    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  }

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId requis' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    const userEmail = userDoc.data().email || 'No email';

    const subRequest = {
      userId,
      userEmail,
      amount: amount || 5,
      currency: "HTG",
      status: "pending",
      paymentMethod: paymentMethod || "Unknown",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('pending_subscriptions').add(subRequest);
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('❌ request-subscription error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}