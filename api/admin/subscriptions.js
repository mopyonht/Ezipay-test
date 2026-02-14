import admin from 'firebase-admin';
import { initFirebase, SUBSCRIPTION_DURATION_DAYS } from '../_utils.js';

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

  const db = initFirebase();

  if (!db) {
    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  }

  // GET - Obtenir les abonnements en attente
  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('pending_subscriptions')
        .where('status', '==', 'pending')
        .get();

      const subs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ success: true, subscriptions: subs });
    } catch (error) {
      console.error('❌ get-pending-subscriptions error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
    return;
  }

  // POST - Approuver ou rejeter un abonnement
  if (req.method === 'POST') {
    const { action, subscriptionId, userId } = req.body;

    if (action === 'approve') {
      if (!subscriptionId || !userId) {
        return res.status(400).json({ success: false, error: 'Paramètres manquants' });
      }

      try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

        const userRef = db.collection('users').doc(userId);
        const batch = db.batch();
        
        batch.update(userRef, {
          subscription: {
            active: true,
            activatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiresAt
          }
        });

        const transRef = userRef.collection('transactions').doc();
        batch.set(transRef, {
          type: "subscription",
          amount: 5,
          status: "completed",
          date: admin.firestore.FieldValue.serverTimestamp()
        });

        const subRef = db.collection('pending_subscriptions').doc(subscriptionId);
        batch.update(subRef, {
          status: "approved",
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        res.json({ success: true, message: 'Abonnement approuvé' });
      } catch (error) {
        console.error('❌ approve-subscription error:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
      return;
    }

    if (action === 'reject') {
      if (!subscriptionId) {
        return res.status(400).json({ success: false, error: 'subscriptionId requis' });
      }

      try {
        await db.collection('pending_subscriptions').doc(subscriptionId).update({
          status: "rejected",
          rejectedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true, message: 'Abonnement rejeté' });
      } catch (error) {
        console.error('❌ reject-subscription error:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
      return;
    }

    return res.status(400).json({ success: false, error: 'Action invalide' });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}