import admin from 'firebase-admin';
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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { matchId, scoreHome, scoreAway, htScoreHome, htScoreAway } = req.body;
  
  console.log('📊 UPDATE MATCH RESULT:', { matchId, scoreHome, scoreAway, htScoreHome, htScoreAway });
  
  if (!matchId || scoreHome === undefined || scoreAway === undefined) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants' });
  }
  
  const db = initFirebase();

  if (!db) {
    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  }
  
  try {
    // Calculer les résultats
    const totalGoals = parseInt(scoreHome) + parseInt(scoreAway);
    let finalResult;
    if (scoreHome > scoreAway) finalResult = '1';
    else if (scoreHome < scoreAway) finalResult = '2';
    else finalResult = 'X';
    
    const btts = (scoreHome > 0 && scoreAway > 0) ? 'Wi' : 'Non';
    
    let htResult = null;
    if (htScoreHome !== undefined && htScoreAway !== undefined) {
      if (htScoreHome > htScoreAway) htResult = '1';
      else if (htScoreHome < htScoreAway) htResult = '2';
      else htResult = 'X';
    }
    
    const matchResult = {
      matchId,
      scoreHome: parseInt(scoreHome),
      scoreAway: parseInt(scoreAway),
      htScoreHome: htScoreHome !== undefined ? parseInt(htScoreHome) : null,
      htScoreAway: htScoreAway !== undefined ? parseInt(htScoreAway) : null,
      finalResult,
      totalGoals,
      btts,
      htResult,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Sauvegarder le résultat dans Firestore
    await db.collection('match_results').doc(matchId).set(matchResult);
    
    // Récupérer TOUTES les fiches pending
    const fichesSnap = await db.collection('fiches')
      .where('status', '==', 'pending')
      .get();
    
    let updatedFichesCount = 0;
    const batch = db.batch();
    
    for (const ficheDoc of fichesSnap.docs) {
      const fiche = ficheDoc.data();
      const choices = fiche.choices || {};
      const matchIds = Object.keys(choices);
      
      // Mettre à jour les résultats pour CE match
      if (fiche.choices && fiche.choices[matchId]) {
        const userChoice = fiche.choices[matchId];
        const updates = {};
        
        if (userChoice.resultat) {
          updates[`choices.${matchId}.actualResult`] = finalResult;
          updates[`choices.${matchId}.correct`] = (userChoice.resultat === finalResult);
        }
        
        if (userChoice.doublechance) {
          const dcOptions = userChoice.doublechance.split('');
          const isCorrect = dcOptions.includes(finalResult);
          updates[`choices.${matchId}.dcActual`] = finalResult;
          updates[`choices.${matchId}.dcCorrect`] = isCorrect;
        }
        
        if (userChoice.btts) {
          updates[`choices.${matchId}.bttsActual`] = btts;
          updates[`choices.${matchId}.bttsCorrect`] = (userChoice.btts === btts);
        }
        
        if (userChoice.total) {
          const threshold = parseFloat(userChoice.total.replace('<', '').replace('>', ''));
          const operator = userChoice.total[0];
          const isCorrect = operator === '<' ? totalGoals < threshold : totalGoals > threshold;
          updates[`choices.${matchId}.totalActual`] = totalGoals;
          updates[`choices.${matchId}.totalCorrect`] = isCorrect;
        }
        
        if (userChoice.mt1 && htResult) {
          updates[`choices.${matchId}.mt1Actual`] = htResult;
          updates[`choices.${matchId}.mt1Correct`] = (userChoice.mt1 === htResult);
        }
        
        if (Object.keys(updates).length > 0) {
          batch.update(ficheDoc.ref, updates);
          updatedFichesCount++;
          
          Object.keys(updates).forEach(key => {
            const keys = key.split('.');
            let obj = fiche;
            for (let i = 0; i < keys.length - 1; i++) {
              if (!obj[keys[i]]) obj[keys[i]] = {};
              obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = updates[key];
          });
        }
      }
      
      // Calculer si le statut doit changer
      let totalMatches = 0;
      let incorrectPredictions = 0;
      let matchesWithResults = 0;
      
      for (const mid of matchIds) {
        const choice = choices[mid];
        if (!choice.matchName) continue;
        
        totalMatches++;
        let hasResult = false;
        
        if (choice.correct !== undefined) {
          hasResult = true;
          if (!choice.correct) incorrectPredictions++;
        }
        if (choice.dcCorrect !== undefined) {
          hasResult = true;
          if (!choice.dcCorrect) incorrectPredictions++;
        }
        if (choice.bttsCorrect !== undefined) {
          hasResult = true;
          if (!choice.bttsCorrect) incorrectPredictions++;
        }
        if (choice.totalCorrect !== undefined) {
          hasResult = true;
          if (!choice.totalCorrect) incorrectPredictions++;
        }
        if (choice.mt1Correct !== undefined) {
          hasResult = true;
          if (!choice.mt1Correct) incorrectPredictions++;
        }
        if (choice.mt2Correct !== undefined) {
          hasResult = true;
          if (!choice.mt2Correct) incorrectPredictions++;
        }
        
        if (hasResult) matchesWithResults++;
      }
      
      // Si 2+ erreurs → LOST
      if (incorrectPredictions >= 2) {
        batch.update(ficheDoc.ref, {
          status: 'lost',
          incorrectPredictions,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📋 Fiche ${ficheDoc.id}: LOST (${incorrectPredictions} erreurs)`);
      }
      // Si tous terminés → won/lost
      else if (matchesWithResults === totalMatches && totalMatches > 0) {
        const newStatus = incorrectPredictions === 0 ? 'won' : 'lost';
        batch.update(ficheDoc.ref, {
          status: newStatus,
          incorrectPredictions,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📋 Fiche ${ficheDoc.id}: ${newStatus}`);
      }
    }
    
    await batch.commit();
    
    console.log(`✅ ${updatedFichesCount} fiches mises à jour pour match ${matchId}`);
    
    res.json({ 
      success: true, 
      message: `Résultat enregistré et ${updatedFichesCount} fiches mises à jour`,
      result: matchResult
    });
    
  } catch (error) {
    console.error('❌ update-match-result error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}