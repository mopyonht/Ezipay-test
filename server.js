const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== FIREBASE INIT (v8 compatible) =====
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore();

// ===== CONFIG EZIPAY =====
const EZIPAY_BASE_URL = 'https://ezipaywallet.com/merchant/api';
const EZIPAY_CLIENT_ID = process.env.EZIPAY_CLIENT_ID;
const EZIPAY_CLIENT_SECRET = process.env.EZIPAY_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://chanpyon509.com';
const SUBSCRIPTION_PRICE = 5; // HTG (TEST)
const SUBSCRIPTION_CURRENCY = 'HTG';
const SUBSCRIPTION_DURATION_DAYS = 30;

// ===== CACHE TOKEN EZIPAY =====
let cachedToken = null;
let tokenExpiry = null;

async function getEziPayToken() {
  // Retourner le token en cache s'il est encore valide (avec marge de 5 min)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('♻️ [TOKEN] Utilisation du token en cache');
    return cachedToken;
  }

  try {
    console.log('🔑 [TOKEN] Demande d\'un nouveau token EziPay...');
    
    const response = await axios.post(`${EZIPAY_BASE_URL}/access-token`, {
      client_id: EZIPAY_CLIENT_ID,
      client_secret: EZIPAY_CLIENT_SECRET
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('📦 [TOKEN] Réponse EziPay:', response.data);

    if (response.data.status === 'success') {
      cachedToken = response.data.data.access_token;
      // Token valide 2h, on met une marge de 5 min
      tokenExpiry = Date.now() + (2 * 60 * 60 * 1000) - (5 * 60 * 1000);
      
      console.log('✅ [TOKEN] Token EziPay obtenu, expire dans ~2h');
      return cachedToken;
    } else {
      throw new Error('Réponse EziPay invalide pour le token');
    }
  } catch (error) {
    console.error('❌ [TOKEN] Erreur obtention token:', error.response?.data || error.message);
    throw new Error('Impossible d\'obtenir le token EziPay');
  }
}

// ===== ROUTE: SANTÉ DU SERVEUR =====
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    ezipay_base_url: EZIPAY_BASE_URL,
    frontend_url: FRONTEND_URL,
    firebase_connected: !!admin.apps.length
  });
});

// ===== ROUTE: INITIER PAIEMENT ABONNEMENT =====
app.post('/api/subscribe', async (req, res) => {
  const { userId } = req.body;

  console.log('💳 [SUBSCRIBE] Demande:', { 
    userId, 
    amount: SUBSCRIPTION_PRICE, 
    currency: SUBSCRIPTION_CURRENCY,
    timestamp: new Date().toISOString()
  });

  if (!userId) {
    console.log('❌ [SUBSCRIBE] userId manquant');
    return res.status(400).json({ success: false, error: 'userId requis' });
  }

  try {
    // 1. Vérifier que l'utilisateur existe
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log('❌ [SUBSCRIBE] Utilisateur non trouvé:', userId);
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    // 2. Obtenir le token EziPay
    const token = await getEziPayToken();

    // 3. Créer la transaction de paiement selon la doc EziPay
    console.log('📤 [SUBSCRIBE] Envoi requête à EziPay...');
    
    const ezipayResponse = await axios.post(
      `${EZIPAY_BASE_URL}/transaction/create`,
      {
        amount: SUBSCRIPTION_PRICE,
        currency: SUBSCRIPTION_CURRENCY,
        successUrl: `${FRONTEND_URL}/ezipay-paiement.html?subscription=success`,
        cancelUrl: `${FRONTEND_URL}/ezipay-paiement.html?subscription=cancel`,
        metadata: JSON.stringify({ userId, type: 'subscription' })
      },
      { 
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        } 
      }
    );

    console.log('📦 [SUBSCRIBE] Réponse EziPay:', ezipayResponse.data);

    if (ezipayResponse.data.status === 'success') {
      const grantId = ezipayResponse.data.data.grant_id;
      const paymentUrl = ezipayResponse.data.data.payment_url;

      // 4. Sauvegarder la transaction en attente dans Firestore
      await db.collection('subscription_transactions').add({
        userId: userId,
        grantId: grantId,
        amount: SUBSCRIPTION_PRICE,
        currency: SUBSCRIPTION_CURRENCY,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('✅ [SUBSCRIBE] Transaction créée, grant_id:', grantId);

      res.json({
        success: true,
        payment_url: paymentUrl,
        grantId: grantId,
        amount: SUBSCRIPTION_PRICE,
        currency: SUBSCRIPTION_CURRENCY
      });
    } else {
      throw new Error('Erreur création transaction EziPay');
    }
  } catch (error) {
    console.error('❌ [SUBSCRIBE] Erreur:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || error.message 
    });
  }
});

// ===== ROUTE: VÉRIFIER PAIEMENT ET ACTIVER ABONNEMENT =====
app.post('/api/verify-subscription', async (req, res) => {
  const { transactionId, userId } = req.body;

  console.log('🔍 [VERIFY] Demande:', { 
    transactionId, 
    userId,
    timestamp: new Date().toISOString()
  });

  if (!transactionId || !userId) {
    console.log('❌ [VERIFY] Paramètres manquants');
    return res.status(400).json({ 
      success: false, 
      error: 'transactionId et userId requis' 
    });
  }

  try {
    // 1. Obtenir le token EziPay
    const token = await getEziPayToken();

    // 2. Vérifier le statut de la transaction avec EziPay (selon la doc)
    console.log('📞 [VERIFY] Appel API EziPay GET /transaction/get/' + transactionId);
    
    const ezipayResponse = await axios.get(
      `${EZIPAY_BASE_URL}/transaction/get/${transactionId}`,
      { 
        headers: { 
          'Authorization': `Bearer ${token}` 
        } 
      }
    );

    console.log('📊 [VERIFY] Réponse EziPay:', ezipayResponse.data);

    // 3. Vérifier le format de la réponse selon la doc
    if (ezipayResponse.data.error === false && ezipayResponse.data.data) {
      const transactionData = ezipayResponse.data.data;
      const transactionStatus = transactionData.status;
      const amount = parseFloat(transactionData.amount);
      const fees = parseFloat(transactionData.fees);

      console.log('📊 [VERIFY] Statut:', transactionStatus, '| Montant:', amount, '| Frais:', fees);

      if (transactionStatus === 'Success') {
        // ✅ PAIEMENT RÉUSSI -> ACTIVER ABONNEMENT
        
        console.log('✅ [VERIFY] Paiement confirmé, activation abonnement...');

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

        // Vérifier que l'utilisateur existe
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
          console.log('❌ [VERIFY] Utilisateur non trouvé:', userId);
          return res.status(404).json({ 
            success: false, 
            message: 'Utilisateur non trouvé' 
          });
        }

        // Activer l'abonnement (compatible Firebase v8)
        await userRef.update({
          subscription: {
            active: true,
            startDate: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiresAt,
            transactionId: transactionId,
            amount: amount,
            currency: SUBSCRIPTION_CURRENCY
          }
        });

        // Enregistrer la transaction dans l'historique de l'utilisateur
        await userRef.collection('transactions').add({
          type: 'subscription',
          amount: amount,
          fees: fees,
          currency: SUBSCRIPTION_CURRENCY,
          status: 'completed',
          transactionId: transactionId,
          date: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mettre à jour la transaction globale
        const transactionQuery = await db.collection('subscription_transactions')
          .where('userId', '==', userId)
          .where('status', '==', 'pending')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!transactionQuery.empty) {
          await transactionQuery.docs[0].ref.update({
            status: 'completed',
            transactionId: transactionId,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: expiresAt
          });
        }

        console.log('✅ [VERIFY] Abonnement activé pour:', userId, '| Expire:', expiresAt.toISOString());

        res.json({
          success: true,
          message: 'Abonnement activé avec succès',
          expiresAt: expiresAt.toISOString(),
          amount: amount,
          fees: fees
        });
      } else {
        // Paiement non réussi
        console.log('⚠️ [VERIFY] Paiement non confirmé:', transactionStatus);
        
        res.json({
          success: false,
          message: `Paiement ${transactionStatus}`,
          status: transactionStatus
        });
      }
    } else {
      throw new Error('Format de réponse EziPay invalide');
    }
  } catch (error) {
    console.error('❌ [VERIFY] Erreur:', error.response?.data || error.message);
    
    // Si l'erreur vient d'EziPay (404 = transaction non trouvée)
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction non trouvée sur EziPay',
        error: 'Transaction ID invalide ou expirée'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || error.message 
    });
  }
});

// ===== ROUTE: CRÉER UN RETRAIT =====
app.post('/api/create-withdrawal', async (req, res) => {
  const { userId, amount, currency, emailOrPhone, paymentMethodId } = req.body;

  console.log('💸 [WITHDRAWAL] Demande:', { 
    userId, 
    amount, 
    currency, 
    emailOrPhone, 
    paymentMethodId,
    timestamp: new Date().toISOString()
  });

  // Validation des paramètres
  if (!userId || !amount || !currency || !emailOrPhone || !paymentMethodId) {
    console.log('❌ [WITHDRAWAL] Paramètres manquants');
    return res.status(400).json({ 
      success: false, 
      error: 'Tous les paramètres sont requis' 
    });
  }

  try {
    // 1. Vérifier le solde de l'utilisateur
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log('❌ [WITHDRAWAL] Utilisateur non trouvé:', userId);
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    const balance = userDoc.data().balance || 0;
    const fees = amount * 0.06; // 6% de frais
    const totalDebit = amount + fees;

    console.log('💰 [WITHDRAWAL] Solde:', balance, '| Total à débiter:', totalDebit);

    if (totalDebit > balance) {
      console.log('❌ [WITHDRAWAL] Solde insuffisant');
      return res.status(400).json({ success: false, error: 'Solde insuffisant' });
    }

    // 2. Obtenir le token EziPay
    const token = await getEziPayToken();

    // 3. Créer le retrait via EziPay (selon la doc)
    console.log('📤 [WITHDRAWAL] Envoi requête à EziPay...');
    
    const requestData = {
      email_or_phone: emailOrPhone,
      currency: currency,
      amount: amount,
      payment_method_id: parseInt(paymentMethodId)
    };

    // Si MonCash (id 16), ajouter le numéro de compte
    if (parseInt(paymentMethodId) === 16) {
      requestData.moncash_account_number = emailOrPhone;
    }

    const ezipayResponse = await axios.post(
      `${EZIPAY_BASE_URL}/send-money/create`,
      requestData,
      { 
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        } 
      }
    );

    console.log('📦 [WITHDRAWAL] Réponse EziPay:', ezipayResponse.data);

    if (ezipayResponse.data.status === 'success') {
      // 4. Débiter le compte
      const newBalance = balance - totalDebit;
      await userRef.update({ balance: newBalance });

      // 5. Enregistrer la transaction
      await userRef.collection('transactions').add({
        type: 'withdrawal',
        amount: amount,
        totalDebit: totalDebit,
        fees: fees,
        currency: currency,
        emailOrPhone: emailOrPhone,
        paymentMethodId: paymentMethodId,
        status: 'completed',
        date: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('✅ [WITHDRAWAL] Retrait effectué, nouveau solde:', newBalance);

      res.json({
        success: true,
        message: 'Retrait effectué avec succès',
        newBalance: newBalance,
        totalDebit: totalDebit
      });
    } else {
      throw new Error('Erreur lors du retrait EziPay');
    }
  } catch (error) {
    console.error('❌ [WITHDRAWAL] Erreur:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || error.message 
    });
  }
});

// ===== ROUTE: OBTENIR LES MÉTHODES DE PAIEMENT =====
app.post('/api/get-payment-methods', async (req, res) => {
  const { currency } = req.body;

  console.log('💳 [PAYMENT-METHODS] Demande:', { currency });

  if (!currency) {
    return res.status(400).json({ success: false, error: 'currency requis (HTG ou USD)' });
  }

  try {
    const token = await getEziPayToken();

    const ezipayResponse = await axios.post(
      `${EZIPAY_BASE_URL}/send-money/get/payment-methods`,
      { currency: currency },
      { 
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        } 
      }
    );

    console.log('📦 [PAYMENT-METHODS] Réponse:', ezipayResponse.data);

    if (ezipayResponse.data.status === 'success') {
      res.json({
        success: true,
        methods: ezipayResponse.data.data
      });
    } else {
      throw new Error('Erreur récupération méthodes de paiement');
    }
  } catch (error) {
    console.error('❌ [PAYMENT-METHODS] Erreur:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || error.message 
    });
  }
});

// ===== EXPORT POUR VERCEL =====
module.exports = app;
