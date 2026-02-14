// Ce fichier n'est là que pour satisfaire Vercel
// Les vraies fonctions sont dans /api
export default function handler(req, res) {
  res.status(200).json({ 
    message: 'API disponible sur /api/*',
    endpoints: [
      '/api/subscribe',
      '/api/verify-subscription',
      '/api/matches',
      '/api/subscription/:userId'
    ]
  });
    }
