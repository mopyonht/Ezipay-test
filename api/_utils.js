import admin from 'firebase-admin';
import axios from 'axios';

// ===== FIREBASE =====
let db = null;

export function initFirebase() {
  if (db) return db;

  const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (firebaseServiceAccount && firebaseServiceAccount !== '{}') {
    try {
      const serviceAccount = typeof firebaseServiceAccount === 'string' 
        ? JSON.parse(firebaseServiceAccount) 
        : firebaseServiceAccount;
      
      if (serviceAccount.project_id) {
        if (!admin.apps.length) {
          admin.initializeApp({ 
            credential: admin.credential.cert(serviceAccount) 
          });
        }
        db = admin.firestore();
        console.log('✅ Firebase connecté à :', serviceAccount.project_id);
      }
    } catch (error) {
      console.warn('⚠️ Erreur Firebase :', error.message);
    }
  }

  return db;
}

// ===== EZIPAY =====
export const EZIPAY_CLIENT_ID = process.env.EZIPAY_CLIENT_ID;
export const EZIPAY_CLIENT_SECRET = process.env.EZIPAY_CLIENT_SECRET;
export const EZIPAY_BASE_URL = 'https://ezipaywallet.com/merchant/api';
export const FRONTEND_URL = 'https://chanpyon509.com';
export const SUBSCRIPTION_PRICE = 150;
export const SUBSCRIPTION_CURRENCY = 'HTG';
export const SUBSCRIPTION_DURATION_DAYS = 30;

// Token cache
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

export async function getEziPayToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  try {
    const response = await axios.post(`${EZIPAY_BASE_URL}/access-token`, {
      client_id: EZIPAY_CLIENT_ID,
      client_secret: EZIPAY_CLIENT_SECRET
    });
    
    const token = response.data.data.access_token;
    tokenCache.accessToken = token;
    tokenCache.expiresAt = Date.now() + (2 * 60 * 60 * 1000);
    
    console.log('✅ Token EziPay obtenu');
    return token;
  } catch (error) {
    console.error('❌ Erreur token:', error.response?.data || error.message);
    throw new Error('Impossible d\'obtenir le token EziPay');
  }
}