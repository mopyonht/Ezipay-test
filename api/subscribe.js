import axios from 'axios';
import admin from 'firebase-admin';
import { 
  initFirebase, 
  getEziPayToken, 
  EZIPAY_BASE_URL, 
  FRONTEND_URL,
  SUBSCRIPTION_PRICE,
  SUBSCRIPTION_CURRENCY
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

  const { userId } = req.body;

  console.log('💳 SUBSCRIPTION INITIATE:', { userId, amount: SUBSCRIPTION_PRICE, currency: SUBSCRIPTION_CURRENCY });

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId requis' });
  }

  try {
    const db = initFirebase();
    const token = await getEziPayToken();

    const ezipayResponse = await axios.post(
      `${EZIPAY_BASE_URL}/transaction/create`,
      {
        amount: SUBSCRIPTION_PRICE,
        currency: SUBSCRIPTION_CURRENCY,
        successUrl: FRONTEND_URL + '/ezipay-paiement.html',
        cancelUrl: FRONTEND_URL + '/ezipay-paiement.html',
        metadata: JSON.stringify({ userId, type: 'subscription' })
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log('✅ EziPay payment URL generated:', ezipayResponse.data.data.payment_url);

    const grantId = ezipayResponse.data.data.grant_id;
    if (db) {
      const userDoc = await db.collection('users').doc(userId).get();
      const userEmail = userDoc.data()?.email || 'No email';
      
      await db.collection('pending_subscriptions').add({
        userId,
        userEmail,
        grantId,
        amount: SUBSCRIPTION_PRICE,
        currency: SUBSCRIPTION_CURRENCY,
        status: 'pending',
        paymentMethod: 'EziPay',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({
      success: true,
      payment_url: ezipayResponse.data.data.payment_url,
      grantId: grantId,
      amount: SUBSCRIPTION_PRICE,
      currency: SUBSCRIPTION_CURRENCY
    });
  } catch (error) {
    console.error('❌ subscribe error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}