import axios from 'axios';
import admin from 'firebase-admin';
import { 
  initFirebase, 
  getEziPayToken, 
  EZIPAY_BASE_URL,
  SUBSCRIPTION_PRICE,
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_DURATION_DAYS
} from './_utils.js';

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

  const { transaction_id, userId } = req.body;

  console.log('🔍 VERIFY SUBSCRIPTION:', { transaction_id, userId });

  if (!transaction_id || !userId) {
    return res.status(400).json({ success: false, error: 'transaction_id et userId requis' });
  }

  try {
    const db = initFirebase();
    const token = await getEziPayToken();

    const ezipayResponse = await axios.get(
      `${EZIPAY_BASE_URL}/transaction/get/${transaction_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const transactionData = ezipayResponse.data.data;
    const transactionStatus = transactionData.status;

    console.log('📊 EziPay transaction status:', transactionStatus);

    if (transactionStatus === 'Success' || transactionStatus === 'success') {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

      if (db) {
        const userRef = db.collection('users').doc(userId);
        await userRef.update({
          subscription: {
            active: true,
            startDate: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
            transactionId: transaction_id
          }
        });

        await db.collection('subscription_transactions').add({
          userId,
          amount: SUBSCRIPTION_PRICE,
          currency: SUBSCRIPTION_CURRENCY,
          status: 'completed',
          transactionId: transaction_id,
          expiresAt,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      console.log('✅ Abonnement activé pour', userId);

      res.json({
        success: true,
        message: 'Abonnement activé avec succès',
        expiresAt: expiresAt.toISOString()
      });
    } else {
      res.json({
        success: false,
        message: 'Paiement non confirmé',
        status: transactionStatus
      });
    }
  } catch (error) {
    console.error('❌ verify-subscription error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}