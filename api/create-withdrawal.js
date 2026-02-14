import axios from 'axios';
import admin from 'firebase-admin';
import { 
  initFirebase, 
  getEziPayToken, 
  EZIPAY_BASE_URL
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

  const { userId, amount, currency, emailOrPhone, paymentMethodId } = req.body;

  console.log('💸 CREATE WITHDRAWAL:', { userId, amount, emailOrPhone });

  const db = initFirebase();

  if (!db) {
    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  }

  if (!userId || !amount || parseFloat(amount) <= 0 || !emailOrPhone || !paymentMethodId) {
    return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  }

  try {
    const token = await getEziPayToken();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const balance = userDoc.data()?.balance || 0;
    const fees = parseFloat(amount) * 0.06;
    const totalDebit = parseFloat(amount) + fees;

    if (balance < totalDebit) {
      return res.json({ success: false, error: 'Solde insuffisant' });
    }

    await axios.post(
      `${EZIPAY_BASE_URL}/send-money/create`,
      {
        email_or_phone: emailOrPhone,
        currency: currency || 'USD',
        amount: parseFloat(amount),
        payment_method_id: parseInt(paymentMethodId)
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const newBalance = balance - totalDebit;
    await userRef.update({ balance: newBalance });

    await userRef.collection('transactions').add({
      type: 'withdrawal',
      amount: parseFloat(amount),
      fees,
      totalDebit,
      status: 'completed',
      emailOrPhone,
      date: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Retrait effectué');

    res.json({ success: true, totalDebit, newBalance });
  } catch (error) {
    console.error('❌ withdrawal error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}